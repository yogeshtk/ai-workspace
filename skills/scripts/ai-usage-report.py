#!/usr/bin/env python3
"""
ai-usage-report.py — deterministic usage, cost and efficiency report for
Claude Code and Devin.

Stdlib only (Python 3.9+). No AI calls. The same input always gives the same numbers.

Data sources
  Claude Code : local session logs in ~/.claude/projects/**/*.jsonl
                (also $CLAUDE_CONFIG_DIR/projects and ~/.config/claude/projects)
  Devin       : the Devin API (set DEVIN_API_KEY) and/or an exported file
                (--devin-file sessions.json|.csv)

Outputs
  * terminal summary (pretty, or --plain for a compact chat-friendly version)
  * a self-contained HTML dashboard (no internet needed to open it)
  * optional sessions CSV (--csv) that opens in Excel / Sheets

Examples
  python3 ai-usage-report.py                      # all periods, writes HTML
  python3 ai-usage-report.py --period 7d          # terminal shows last 7 days
  python3 ai-usage-report.py --since 2026-10-01 --until 2026-10-31
  python3 ai-usage-report.py --plain --no-html    # minimal text only
"""
from __future__ import annotations

import argparse
import csv
import glob
import html
import json
import math
import os
import re
import statistics
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

# --------------------------------------------------------------------------- #
# Pricing (USD per million tokens). Longest matching prefix wins.
# (input, output, cache_read). Cache writes: 5-minute = 1.25x input,
# 1-hour = 2x input. Override with --pricing my-prices.json (same shape).
# --------------------------------------------------------------------------- #
PRICING = {
    "claude-fable-5-2":   (8.00, 40.00, 0.20),
    "claude-mythos-5-2":  (8.00, 40.00, 0.20),
    "claude-fable-5-1":   (10.00, 50.00, 0.25),
    "claude-mythos-5-1":  (10.00, 50.00, 0.25),
    "claude-fable-5":     (10.00, 50.00, 1.00),
    "claude-mythos-5":    (10.00, 50.00, 1.00),
    "claude-opus-5-5":    (4.00, 20.00, 0.20),
    "claude-opus-5":      (5.00, 25.00, 0.50),
    "claude-opus-4-8":    (5.00, 25.00, 0.50),
    "claude-opus-4-7":    (5.00, 25.00, 0.50),
    "claude-opus-4-6":    (5.00, 25.00, 0.50),
    "claude-opus-4-5":    (5.00, 25.00, 0.50),
    "claude-opus-4-1":    (15.00, 75.00, 1.50),
    "claude-opus-4":      (15.00, 75.00, 1.50),
    "claude-3-opus":      (15.00, 75.00, 1.50),
    "claude-sonnet-5-5":  (2.00, 10.00, 0.10),
    "claude-sonnet-5":    (2.00, 10.00, 0.20),
    "claude-sonnet-4":    (3.00, 15.00, 0.30),
    "claude-3-7-sonnet":  (3.00, 15.00, 0.30),
    "claude-3-5-sonnet":  (3.00, 15.00, 0.30),
    "claude-haiku-5-5":   (0.10, 0.50, 0.01),
    "claude-haiku-4-5":   (1.00, 5.00, 0.10),
    "claude-3-5-haiku":   (0.80, 4.00, 0.08),
    "claude-3-haiku":     (0.25, 1.25, 0.03),
}
# Models with a price step above a prompt size: model -> (threshold, input, output, cache_read)
PRICING_TIERS = {"claude-haiku-5-5": (100_000, 0.50, 2.50, 0.05)}
# Fast-mode multiplier on all token prices
FAST_MULT = {"claude-opus-5-5": 2.0, "claude-fable-5-2": 2.0, "claude-mythos-5-2": 2.0,
             "claude-opus-5": 2.0, "claude-opus-4-8": 2.0}
DEFAULT_ACU_PRICE = 2.25  # USD per Devin ACU — change with --acu-price

PERIODS = [("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days"),
           ("90d", "Last 3 months"), ("all", "All time")]

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def parse_ts(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        v = float(v)
        if v > 1e12:
            v /= 1000.0
        return datetime.fromtimestamp(v, tz=timezone.utc)
    s = str(v).strip()
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return parse_ts(float(s))
    s = s.replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        try:
            d = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def price_for(model: str):
    m = (model or "").lower()
    for key in sorted(PRICING, key=len, reverse=True):
        if m.startswith(key) or key in m:
            return key, PRICING[key]
    return None, None


def call_cost(model, inp, out, cw5, cw1h, cr, fast=False):
    key, p = price_for(model)
    if not p:
        return 0.0, False
    pin, pout, pcr = p
    if key in PRICING_TIERS:
        thr, tin, tout, tcr = PRICING_TIERS[key]
        if inp + cw5 + cw1h + cr > thr:
            pin, pout, pcr = tin, tout, tcr
    mult = FAST_MULT.get(key, 1.0) if fast else 1.0
    cost = (inp * pin + out * pout + cw5 * pin * 1.25 + cw1h * pin * 2.0 + cr * pcr) / 1e6
    return cost * mult, True


def fmt_money(x):
    if x >= 1000:
        return f"${x:,.0f}"
    if x >= 100:
        return f"${x:,.1f}"
    return f"${x:,.2f}"


def fmt_tok(n):
    n = float(n)
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.1f}{unit}"
    return f"{int(n)}"


def fmt_dur(sec):
    sec = int(max(sec or 0, 0))
    h, r = divmod(sec, 3600)
    m = r // 60
    return f"{h}h {m:02d}m" if h else f"{m}m"


def pct(x):
    return f"{x * 100:.1f}%" if x is not None else "–"


_repo_cache: dict = {}


def repo_for(cwd: str | None) -> str:
    """owner/repo from the git remote if the folder still exists, else folder name."""
    if not cwd:
        return "(unknown)"
    if cwd in _repo_cache:
        return _repo_cache[cwd]
    name = os.path.basename(cwd.rstrip("/\\")) or cwd
    d = cwd
    for _ in range(8):
        cfg = os.path.join(d, ".git", "config")
        if os.path.isfile(cfg):
            try:
                txt = open(cfg, encoding="utf-8", errors="ignore").read()
                m = re.search(r'\[remote "origin"\][^\[]*?url\s*=\s*(\S+)', txt)
                if m:
                    url = m.group(1)
                    mm = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?/?$", url)
                    if mm:
                        name = mm.group(1)
            except OSError:
                pass
            break
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    _repo_cache[cwd] = name
    return name


# --------------------------------------------------------------------------- #
# Claude Code loader
# --------------------------------------------------------------------------- #

def claude_dirs(extra):
    cands = []
    if extra:
        cands += extra
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        cands.append(os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "projects"))
    home = os.path.expanduser("~")
    cands += [os.path.join(home, ".claude", "projects"),
              os.path.join(home, ".config", "claude", "projects")]
    seen, out = set(), []
    for c in cands:
        rc = os.path.realpath(c)
        if os.path.isdir(rc) and rc not in seen:
            seen.add(rc)
            out.append(rc)
    return out


def _text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return ""


def load_claude(dirs, warn):
    """Return (calls, events, sessions). Every record carries a timestamp so
    any date window can be applied later."""
    files = []
    for d in dirs:
        files += glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True)
    files.sort()

    best_call = {}  # dedupe key -> record (streamed messages repeat across lines)
    events = []     # prompts / interrupts / tool uses / tool errors
    sessions = {}
    seen_tool_ids = set()
    tool_names = {}  # tool_use_id -> name
    seen_results = set()

    for path in files:
        is_sub = os.sep + "subagents" + os.sep in path
        try:
            fh = open(path, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                sid = d.get("sessionId") or os.path.splitext(os.path.basename(path))[0]
                if is_sub:  # subagent transcripts roll up into the parent session
                    parent = os.path.basename(os.path.dirname(os.path.dirname(path)))
                    if re.fullmatch(r"[0-9a-f-]{36}", parent):
                        sid = parent
                t = d.get("type")
                s = sessions.setdefault(sid, {
                    "id": sid, "source": "Claude", "title": "", "cwd": None, "branch": None,
                    "entrypoint": None, "version": None, "first_prompt": "",
                })
                if t == "ai-title" and d.get("aiTitle"):
                    s["title"] = d["aiTitle"]
                    continue
                if t == "summary" and d.get("summary") and not s["title"]:
                    s["title"] = d["summary"]
                    continue
                ts = parse_ts(d.get("timestamp"))
                if ts is None:
                    continue
                if d.get("cwd") and not s["cwd"]:
                    s["cwd"] = d["cwd"]
                if d.get("gitBranch") and not s["branch"]:
                    s["branch"] = d["gitBranch"]
                if d.get("entrypoint") and not s["entrypoint"]:
                    s["entrypoint"] = d["entrypoint"]
                if d.get("version"):
                    s["version"] = d["version"]
                msg = d.get("message") or {}

                if t == "assistant":
                    u = msg.get("usage") or {}
                    model = msg.get("model") or ""
                    if model.startswith("<") or not u:
                        pass
                    else:
                        cc = u.get("cache_creation") or {}
                        cw_total = int(u.get("cache_creation_input_tokens") or 0)
                        cw1h = int(cc.get("ephemeral_1h_input_tokens") or 0)
                        cw5 = int(cc.get("ephemeral_5m_input_tokens") or 0)
                        if cw5 + cw1h == 0:
                            cw5 = cw_total
                        elif cw5 + cw1h < cw_total:
                            cw5 += cw_total - (cw5 + cw1h)
                        rec = {
                            "ts": ts, "sid": sid, "source": "Claude", "model": model,
                            "in": int(u.get("input_tokens") or 0),
                            "out": int(u.get("output_tokens") or 0),
                            "cw5": cw5, "cw1h": cw1h,
                            "cr": int(u.get("cache_read_input_tokens") or 0),
                            "fast": u.get("speed") == "fast",
                            "sub": bool(is_sub or d.get("isSidechain")),
                            "web": int((u.get("server_tool_use") or {}).get("web_search_requests") or 0),
                        }
                        key = (msg.get("id") or d.get("uuid"), d.get("requestId"))
                        prev = best_call.get(key)
                        if prev is None or rec["out"] >= prev["out"]:
                            best_call[key] = rec
                    for b in msg.get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_use":
                            tid = b.get("id")
                            if tid in seen_tool_ids:
                                continue
                            seen_tool_ids.add(tid)
                            name = b.get("name") or "?"
                            tool_names[tid] = name
                            events.append({"ts": ts, "sid": sid, "kind": "tool", "name": name})

                elif t == "user":
                    content = msg.get("content")
                    if isinstance(content, list):
                        for b in content:
                            if isinstance(b, dict) and b.get("type") == "tool_result":
                                tid = b.get("tool_use_id")
                                if tid in seen_results:
                                    continue
                                seen_results.add(tid)
                                if b.get("is_error"):
                                    events.append({"ts": ts, "sid": sid, "kind": "tool_error",
                                                   "name": tool_names.get(tid, "?")})
                    if d.get("isMeta") or is_sub or d.get("isSidechain"):
                        continue
                    text = _text_of(content).strip()
                    if not text:
                        continue
                    if text.startswith("[Request interrupted"):
                        events.append({"ts": ts, "sid": sid, "kind": "interrupt"})
                        continue
                    if text.startswith(("<local-command", "<command-stdout", "Caveat:")):
                        continue
                    if not s["first_prompt"]:
                        s["first_prompt"] = text[:160]
                    events.append({"ts": ts, "sid": sid, "kind": "prompt"})

    calls = []
    unpriced = Counter()
    for rec in best_call.values():
        cost, ok = call_cost(rec["model"], rec["in"], rec["out"], rec["cw5"], rec["cw1h"],
                             rec["cr"], rec["fast"])
        if not ok:
            unpriced[rec["model"]] += 1
        rec["cost"] = cost
        calls.append(rec)
    for m, n in sorted(unpriced.items()):
        warn(f"No price for model '{m}' ({n} calls) — counted as $0. Add it with --pricing.")
    for s in sessions.values():
        s["repo"] = repo_for(s["cwd"])
        if not s["title"]:
            s["title"] = s["first_prompt"][:80] or s["id"][:8]
    calls.sort(key=lambda r: (r["ts"], r["sid"]))
    events.sort(key=lambda r: (r["ts"], r["sid"], r["kind"]))
    return calls, events, sessions, len(files)


# --------------------------------------------------------------------------- #
# Devin loader
# --------------------------------------------------------------------------- #

def _first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return None


def _devin_norm(raw, acu_price):
    sid = str(_first(raw, "session_id", "id", "devin_id") or "")
    if not sid:
        return None
    created = parse_ts(_first(raw, "created_at", "start_time", "started_at", "created"))
    updated = parse_ts(_first(raw, "updated_at", "end_time", "ended_at", "last_activity_at")) or created
    if created is None:
        return None
    acus = _first(raw, "acus_consumed", "acu_used", "acus", "consumed_acus", "acu_usage", "ACUs")
    try:
        acus = float(acus or 0)
    except (TypeError, ValueError):
        acus = 0.0
    repo = _first(raw, "repo", "repository", "repo_name", "repos", "repositories")
    if isinstance(repo, list):
        repo = ", ".join(str(r.get("name") if isinstance(r, dict) else r) for r in repo[:3])
    pr = _first(raw, "pull_request", "pull_requests", "prs")
    prs = 0
    if isinstance(pr, list):
        prs = len(pr)
    elif isinstance(pr, dict) and (pr.get("url") or pr.get("number")):
        prs = 1
    elif isinstance(pr, str) and pr:
        prs = 1
    if not repo and isinstance(pr, dict) and pr.get("url"):
        m = re.search(r"github\.com/([^/]+/[^/]+)/pull", pr["url"])
        repo = m.group(1) if m else None
    msgs = _first(raw, "message_count", "num_messages", "messages_count")
    if isinstance(_first(raw, "messages"), list):
        msgs = len(raw["messages"])
    return {
        "id": sid, "source": "Devin",
        "title": str(_first(raw, "title", "name") or _first(raw, "prompt", "initial_message") or sid)[:100],
        "status": str(_first(raw, "status_enum", "status") or ""),
        "repo": str(repo or "(unknown)"), "origin": str(_first(raw, "origin", "source") or ""),
        "created": created, "updated": updated, "acus": acus, "cost": acus * acu_price,
        "prs": prs, "messages": int(msgs or 0),
    }


def _devin_api(base, key, warn, max_pages=200):
    out, offset, cursor = [], 0, None
    for _ in range(max_pages):
        q = {"limit": 100}
        if cursor:
            q["cursor"] = cursor
        else:
            q["offset"] = offset
        url = base.rstrip("/") + ("&" if "?" in base else "?") + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}",
                                                   "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 — report and continue with what we have
            warn(f"Devin API request failed ({e}). Use --devin-file with an export instead.")
            break
        items = data if isinstance(data, list) else (
            _first(data, "sessions", "items", "data", "results") or [])
        out += items
        cursor = isinstance(data, dict) and _first(data, "next_cursor", "cursor", "next")
        if not items or (not cursor and len(items) < 100):
            break
        offset += len(items)
    return out


def load_devin(args, warn):
    raws = []
    for f in args.devin_file or []:
        try:
            if f.lower().endswith(".csv"):
                with open(f, newline="", encoding="utf-8-sig") as fh:
                    raws += list(csv.DictReader(fh))
            else:
                data = json.load(open(f, encoding="utf-8"))
                raws += data if isinstance(data, list) else (
                    _first(data, "sessions", "items", "data", "results") or [])
        except (OSError, ValueError) as e:
            warn(f"Could not read Devin file {f}: {e}")
    key = os.environ.get("DEVIN_API_KEY")
    if key and not args.no_devin_api:
        base = os.environ.get("DEVIN_API_URL", "https://api.devin.ai/v1/sessions")
        raws += _devin_api(base, key, warn)
    sessions, seen = [], set()
    for r in raws:
        s = _devin_norm(r, args.acu_price)
        if s and s["id"] not in seen:
            seen.add(s["id"])
            sessions.append(s)
    sessions.sort(key=lambda s: (s["created"], s["id"]))
    return sessions


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #

def efficiency(cache_hit, tool_calls, tool_errors, calls, prompts, avg_ctx):
    """0-100 score. Weights: cache 40, tool success 20, autonomy 20, lean context 20."""
    parts = {
        "cache": 40 * (cache_hit or 0),
        "tools": 20 * (1 - (tool_errors / tool_calls) if tool_calls else 1),
        "autonomy": 20 * min((calls / prompts) / 8.0, 1.0) if prompts else 10,
        "context": 20 * (1 - min(avg_ctx / 400_000, 1.0)),
    }
    return round(sum(parts.values())), parts


def summarize(calls, events, csessions, dsessions, start, end):
    def inwin(ts):
        return (start is None or ts >= start) and (end is None or ts < end)

    C = [c for c in calls if inwin(c["ts"])]
    E = [e for e in events if inwin(e["ts"])]
    D = [s for s in dsessions if inwin(s["created"])]

    tot = Counter()
    for c in C:
        for k in ("in", "out", "cw5", "cw1h", "cr", "web"):
            tot[k] += c[k]
        tot["cost"] += c["cost"]
    input_side = tot["in"] + tot["cw5"] + tot["cw1h"] + tot["cr"]
    cache_hit = tot["cr"] / input_side if input_side else None
    # money the cache saved vs paying full input price for the cache reads
    saved = 0.0
    for c in C:
        key, p = price_for(c["model"])
        if p:
            saved += c["cr"] * (p[0] - p[2]) / 1e6
    one_h_premium = sum((c["cw1h"] * (price_for(c["model"])[1] or (0,))[0] * 0.75) / 1e6
                        for c in C if c["cw1h"])

    # per-session
    per = defaultdict(lambda: {"calls": 0, "in": 0, "out": 0, "cw": 0, "cr": 0, "cost": 0.0,
                               "models": Counter(), "tools": Counter(), "tool_err": 0,
                               "prompts": 0, "interrupts": 0, "first": None, "last": None,
                               "sub_cost": 0.0, "ctx_sum": 0})
    for c in C:
        p = per[c["sid"]]
        p["calls"] += 1
        p["in"] += c["in"]
        p["out"] += c["out"]
        p["cw"] += c["cw5"] + c["cw1h"]
        p["cr"] += c["cr"]
        p["cost"] += c["cost"]
        p["models"][c["model"]] += c["cost"]
        p["ctx_sum"] += c["in"] + c["cw5"] + c["cw1h"] + c["cr"]
        if c["sub"]:
            p["sub_cost"] += c["cost"]
        p["first"] = c["ts"] if p["first"] is None else min(p["first"], c["ts"])
        p["last"] = c["ts"] if p["last"] is None else max(p["last"], c["ts"])
    tools_all, tool_err_all = Counter(), Counter()
    hours = Counter()
    for e in E:
        p = per[e["sid"]]
        k = e["kind"]
        if k == "tool":
            p["tools"][e["name"]] += 1
            tools_all[e["name"]] += 1
        elif k == "tool_error":
            p["tool_err"] += 1
            tool_err_all[e["name"]] += 1
        elif k == "prompt":
            p["prompts"] += 1
            lt = e["ts"].astimezone()
            hours[(lt.weekday(), lt.hour)] += 1
        elif k == "interrupt":
            p["interrupts"] += 1
        p["first"] = e["ts"] if p["first"] is None else min(p["first"], e["ts"])
        p["last"] = e["ts"] if p["last"] is None else max(p["last"], e["ts"])

    rows = []
    for sid, p in per.items():
        meta = csessions.get(sid, {})
        side = p["in"] + p["cw"] + p["cr"]
        ch = p["cr"] / side if side else None
        ntools = sum(p["tools"].values())
        avg_ctx = p["ctx_sum"] / p["calls"] if p["calls"] else 0
        score, parts = efficiency(ch, ntools, p["tool_err"], p["calls"], p["prompts"], avg_ctx)
        flags = []
        if ch is not None and ch < 0.7 and p["calls"] >= 5:
            flags.append("low cache")
        if ntools >= 5 and p["tool_err"] / ntools > 0.2:
            flags.append("tool errors")
        if avg_ctx > 200_000:
            flags.append("huge context")
        if p["interrupts"] >= 3:
            flags.append("many interrupts")
        if p["prompts"] and p["cost"] / p["prompts"] > 5:
            flags.append("costly prompts")
        rows.append({
            "source": "Claude", "id": sid, "title": meta.get("title") or sid[:8],
            "repo": meta.get("repo", "(unknown)"), "branch": meta.get("branch") or "",
            "entry": meta.get("entrypoint") or "",
            "start": p["first"], "end": p["last"],
            "dur": (p["last"] - p["first"]).total_seconds() if p["first"] else 0,
            "prompts": p["prompts"], "calls": p["calls"], "interrupts": p["interrupts"],
            "tokens": p["in"] + p["out"] + p["cw"] + p["cr"], "in": p["in"], "out": p["out"],
            "cw": p["cw"], "cr": p["cr"], "cost": p["cost"], "sub_cost": p["sub_cost"],
            "cache_hit": ch, "avg_ctx": avg_ctx,
            "model": p["models"].most_common(1)[0][0] if p["models"] else "",
            "tools": p["tools"], "tool_calls": ntools, "tool_err": p["tool_err"],
            "score": score if p["calls"] else None, "parts": parts, "flags": flags,
        })
    for s in D:
        rows.append({
            "source": "Devin", "id": s["id"], "title": s["title"], "repo": s["repo"],
            "branch": "", "entry": s["origin"] or "devin", "start": s["created"], "end": s["updated"],
            "dur": (s["updated"] - s["created"]).total_seconds(), "prompts": s["messages"],
            "calls": 0, "interrupts": 0, "tokens": 0, "in": 0, "out": 0, "cw": 0, "cr": 0,
            "cost": s["cost"], "sub_cost": 0.0, "cache_hit": None, "avg_ctx": 0,
            "model": "Devin", "tools": Counter(), "tool_calls": 0, "tool_err": 0,
            "score": None, "parts": {}, "flags": [], "acus": s["acus"], "status": s["status"],
            "prs": s["prs"],
        })
    rows.sort(key=lambda r: (-r["cost"], r["id"]))

    claude_rows = [r for r in rows if r["source"] == "Claude" and r["score"] is not None]
    w = sum(r["cost"] for r in claude_rows)
    eff = round(sum(r["score"] * r["cost"] for r in claude_rows) / w) if w else (
        round(statistics.mean(r["score"] for r in claude_rows)) if claude_rows else None)

    by_model = Counter()
    for c in C:
        by_model[price_for(c["model"])[0] or c["model"]] += c["cost"]
    by_repo = defaultdict(lambda: Counter())
    for r in rows:
        b = by_repo[r["repo"]]
        b["sessions"] += 1
        b["cost"] += r["cost"]
        b["tokens"] += r["tokens"]
        b["cr"] += r["cr"]
        b["side"] += r["in"] + r["cw"] + r["cr"]
        b["prompts"] += r["prompts"]
        b[r["source"]] += 1
    daily = defaultdict(Counter)
    for c in C:
        dk = c["ts"].astimezone().strftime("%Y-%m-%d")
        daily[dk]["Claude"] += c["cost"]
        daily[dk]["cr"] += c["cr"]
        daily[dk]["side"] += c["in"] + c["cw5"] + c["cw1h"] + c["cr"]
    for s in D:
        daily[s["created"].astimezone().strftime("%Y-%m-%d")]["Devin"] += s["cost"]

    devin_cost = sum(s["cost"] for s in D)
    prompts = sum(1 for e in E if e["kind"] == "prompt") + sum(s["messages"] for s in D)
    total_tool = sum(tools_all.values())
    return {
        "start": start, "end": end,
        "claude_cost": tot["cost"], "devin_cost": devin_cost, "cost": tot["cost"] + devin_cost,
        "tokens": tot["in"] + tot["out"] + tot["cw5"] + tot["cw1h"] + tot["cr"],
        "in": tot["in"], "out": tot["out"], "cw5": tot["cw5"], "cw1h": tot["cw1h"], "cr": tot["cr"],
        "web": tot["web"], "cache_hit": cache_hit, "cache_saved": saved, "one_h_premium": one_h_premium,
        "sessions": len(rows), "claude_sessions": sum(1 for r in rows if r["source"] == "Claude"),
        "devin_sessions": len(D), "devin_acus": sum(s["acus"] for s in D),
        "devin_prs": sum(s["prs"] for s in D),
        "calls": len(C), "prompts": prompts,
        "interrupts": sum(1 for e in E if e["kind"] == "interrupt"),
        "tool_calls": total_tool, "tool_errors": sum(tool_err_all.values()),
        "tools": tools_all, "tool_err": tool_err_all, "efficiency": eff,
        "by_model": by_model, "by_repo": by_repo, "daily": daily, "hours": hours, "rows": rows,
        "sub_cost": sum(c["cost"] for c in C if c["sub"]),
        "active_days": len(daily),
    }


def insights(S):
    out = []
    if S["cache_hit"] is not None:
        if S["cache_hit"] >= 0.9:
            out.append(("good", f"Cache hit ratio {pct(S['cache_hit'])} — excellent. Caching saved you "
                                f"{fmt_money(S['cache_saved'])}."))
        elif S["cache_hit"] >= 0.75:
            out.append(("ok", f"Cache hit ratio {pct(S['cache_hit'])} — decent; caching saved "
                              f"{fmt_money(S['cache_saved'])}. Longer, continuous sessions push it above 90%."))
        else:
            out.append(("bad", f"Cache hit ratio only {pct(S['cache_hit'])}. Many short sessions, "
                               "frequent /clear, or editing CLAUDE.md mid-session break the cache."))
    rows = [r for r in S["rows"] if r["cost"] > 0]
    if len(rows) >= 5 and S["cost"]:
        top = sum(r["cost"] for r in rows[:3]) / S["cost"]
        if top > 0.4:
            out.append(("ok", f"Your 3 most expensive sessions are {pct(top)} of all spend — open them "
                              "in the table below to see why."))
    if S["tool_calls"] >= 20:
        er = S["tool_errors"] / S["tool_calls"]
        worst = max(S["tool_err"].items(), key=lambda kv: (kv[1], kv[0]), default=None)
        if er > 0.1 and worst:
            out.append(("bad", f"{pct(er)} of tool calls failed; most errors from {worst[0]} "
                               f"({worst[1]})."))
        else:
            out.append(("good", f"Tool success rate {pct(1 - er)} across {S['tool_calls']:,} tool calls."))
    if S["prompts"]:
        out.append(("ok", f"Average cost per prompt: {fmt_money(S['cost'] / S['prompts'])}; "
                          f"{S['calls'] / max(S['prompts'], 1):.1f} model calls per prompt you typed."))
    if S["interrupts"] >= 5:
        out.append(("ok", f"You interrupted Claude {S['interrupts']} times — clearer first prompts "
                          "usually cut this down."))
    if S["one_h_premium"] > 1:
        out.append(("ok", f"1-hour cache writes cost {fmt_money(S['one_h_premium'])} more than 5-minute "
                          "writes would have; worth it only if you pause >5 min between prompts."))
    if S["sub_cost"] > 0.25 * max(S["claude_cost"], 1e-9) and S["sub_cost"] > 1:
        out.append(("ok", f"Subagents used {pct(S['sub_cost'] / S['claude_cost'])} of Claude spend."))
    huge = [r for r in rows if "huge context" in r["flags"]]
    if huge:
        out.append(("bad", f"{len(huge)} session(s) averaged >200K tokens of context per call. "
                           "Compacting or starting fresh sessions makes them cheaper."))
    return out


# --------------------------------------------------------------------------- #
# Terminal output
# --------------------------------------------------------------------------- #

class Style:
    def __init__(self, on):
        self.on = on

    def __call__(self, s, code):
        return f"\033[{code}m{s}\033[0m" if self.on else s


def bar(frac, width=24):
    frac = max(0.0, min(1.0, frac or 0))
    full = int(frac * width)
    rem = frac * width - full
    parts = " ▏▎▍▌▋▊▉"
    return "█" * full + (parts[int(rem * 8)] if full < width else "") + " " * (width - full - 1)


def spark(vals):
    if not vals:
        return ""
    m = max(vals) or 1
    ticks = "▁▂▃▄▅▆▇█"
    return "".join(ticks[min(int(v / m * 7.999), 7)] if v else " " for v in vals)


def render_terminal(S, label, st, top=10, plain=False):
    L = []
    rng = f"{S['start'].astimezone():%Y-%m-%d} → {(S['end'] - timedelta(seconds=1)).astimezone():%Y-%m-%d}" \
        if S["start"] else "all time"
    if plain:
        L.append(f"AI usage — {label} ({rng})")
        L.append(f"Cache hit ratio: {pct(S['cache_hit'])} | Efficiency: {S['efficiency'] if S['efficiency'] is not None else '–'}/100")
        L.append(f"Cost: {fmt_money(S['cost'])} (Claude {fmt_money(S['claude_cost'])}, Devin {fmt_money(S['devin_cost'])}) "
                 f"| Tokens: {fmt_tok(S['tokens'])} | Sessions: {S['sessions']} | Prompts: {S['prompts']}")
        L.append(f"Cache saved: {fmt_money(S['cache_saved'])} | Tool calls: {S['tool_calls']} "
                 f"({S['tool_errors']} failed)")
        if S["tools"]:
            L.append("Top tools: " + ", ".join(f"{k} {v}" for k, v in S["tools"].most_common(6)))
        repos = sorted(S["by_repo"].items(), key=lambda kv: (-kv[1]["cost"], kv[0]))[:5]
        if repos:
            L.append("Top repos: " + ", ".join(f"{k} {fmt_money(v['cost'])}" for k, v in repos))
        for kind, msg in insights(S)[:4]:
            L.append(f"- {msg}")
        return "\n".join(L)

    W = 78
    L.append(st("━" * W, "2"))
    L.append(st(f" AI USAGE  ·  {label}  ·  {rng}", "1;36"))
    L.append(st("━" * W, "2"))
    ch = S["cache_hit"]
    col = "32" if (ch or 0) >= 0.9 else "33" if (ch or 0) >= 0.75 else "31"
    L.append(f" {st('CACHE HIT RATIO', '1')}  {st(pct(ch).rjust(7), '1;' + col)}  {st(bar(ch, 30), col)}"
             f"  saved {st(fmt_money(S['cache_saved']), '32')}")
    eff = S["efficiency"]
    L.append(f" {st('EFFICIENCY', '1')}       {st((str(eff) + '/100').rjust(7) if eff is not None else '      –', '1')}  "
             f"{st(bar((eff or 0) / 100, 30), '36')}")
    L.append("")
    kv = [("Total cost", fmt_money(S["cost"])), ("Claude", fmt_money(S["claude_cost"])),
          ("Devin", f"{fmt_money(S['devin_cost'])} ({S['devin_acus']:.1f} ACU)"),
          ("Tokens", fmt_tok(S["tokens"])), ("Sessions", f"{S['sessions']}"),
          ("Prompts", f"{S['prompts']:,}"), ("Model calls", f"{S['calls']:,}"),
          ("Tool calls", f"{S['tool_calls']:,} ({S['tool_errors']} failed)")]
    for i in range(0, len(kv), 2):
        a, b = kv[i], kv[i + 1] if i + 1 < len(kv) else ("", "")
        L.append(f" {st(a[0], '2'):<{14 + (9 if st.on else 0)}}{a[1]:<24} {st(b[0], '2'):<{14 + (9 if st.on else 0)}}{b[1]}")
    L.append("")
    tk = [("input", S["in"]), ("cache write", S["cw5"] + S["cw1h"]), ("cache read", S["cr"]), ("output", S["out"])]
    tt = sum(v for _, v in tk) or 1
    L.append(" " + st("Token mix", "1") + "   " + "  ".join(f"{n} {fmt_tok(v)} ({v / tt * 100:.0f}%)" for n, v in tk))
    if S["daily"]:
        days = sorted(S["daily"])
        d0 = datetime.strptime(days[0], "%Y-%m-%d")
        d1 = datetime.strptime(days[-1], "%Y-%m-%d")
        seq = [(d0 + timedelta(days=i)).strftime("%Y-%m-%d") for i in range((d1 - d0).days + 1)][-60:]
        vals = [S["daily"][d]["Claude"] + S["daily"][d]["Devin"] for d in seq]
        L.append(" " + st("Daily cost", "1") + "  " + st(spark(vals), "36") + f"  peak {fmt_money(max(vals))}")
    L.append("")
    if S["by_model"]:
        L.append(st(" Spend by model", "1"))
        m = max(S["by_model"].values()) or 1
        for k, v in sorted(S["by_model"].items(), key=lambda kv: (-kv[1], kv[0]))[:6]:
            L.append(f"   {k:<22} {st(bar(v / m, 20), '35')} {fmt_money(v)}")
    if S["by_repo"]:
        L.append(st(" Top repos", "1"))
        repos = sorted(S["by_repo"].items(), key=lambda kv: (-kv[1]["cost"], kv[0]))[:6]
        m = max(v["cost"] for _, v in repos) or 1
        for k, v in repos:
            chr_ = v["cr"] / v["side"] if v["side"] else None
            L.append(f"   {k[:22]:<22} {st(bar(v['cost'] / m, 20), '34')} {fmt_money(v['cost']):>8}  "
                     f"{int(v['sessions'])} sess  cache {pct(chr_)}")
    if S["tools"]:
        L.append(st(" Top tools", "1"))
        m = max(S["tools"].values())
        for k, v in S["tools"].most_common(8):
            e = S["tool_err"].get(k, 0)
            L.append(f"   {k[:22]:<22} {st(bar(v / m, 20), '33')} {v:>6,}" + (st(f"  {e} failed", "31") if e else ""))
    L.append("")
    if S["rows"]:
        L.append(st(f" Top {min(top, len(S['rows']))} sessions by cost", "1"))
        L.append(st(f"   {'date':<11}{'src':<7}{'repo':<20}{'cost':>9}{'cache':>8}{'score':>7}  title", "2"))
        for r in S["rows"][:top]:
            sc = "–" if r["score"] is None else str(r["score"])
            L.append(f"   {r['start'].astimezone():%Y-%m-%d} {r['source']:<7}{r['repo'][:19]:<20}"
                     f"{fmt_money(r['cost']):>9}{pct(r['cache_hit']):>8}{sc:>7}  {r['title'][:40]}")
    ins = insights(S)
    if ins:
        L.append("")
        L.append(st(" Insights", "1"))
        icon = {"good": st("●", "32"), "ok": st("●", "33"), "bad": st("●", "31")}
        for kind, msg in ins:
            L.append(f"   {icon[kind]} {msg}")
    L.append(st("━" * W, "2"))
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# HTML output (inline SVG charts, tiny JS for tabs/sorting — fully offline)
# --------------------------------------------------------------------------- #
E = html.escape


def svg_daily(S, days_n=None):
    if not S["daily"]:
        return '<p class="muted">No activity.</p>'
    days = sorted(S["daily"])
    d0 = datetime.strptime(days[0], "%Y-%m-%d")
    if S["start"]:
        d0 = min(d0, datetime.strptime(S["start"].astimezone().strftime("%Y-%m-%d"), "%Y-%m-%d"))
    d1 = datetime.strptime(days[-1], "%Y-%m-%d")
    seq = [(d0 + timedelta(days=i)).strftime("%Y-%m-%d") for i in range((d1 - d0).days + 1)]
    if len(seq) > 120:  # weekly buckets for long ranges
        buckets = defaultdict(Counter)
        for d in seq:
            dt = datetime.strptime(d, "%Y-%m-%d")
            wk = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
            buckets[wk].update(S["daily"].get(d, Counter()))
        seq = sorted(buckets)
        data = buckets
        unit = "week of "
    else:
        data = S["daily"]
        unit = ""
    W, H, pl, pb, pt = 720, 200, 44, 22, 10
    n = len(seq)
    vals = [(data[d]["Claude"] if d in data else 0, data[d]["Devin"] if d in data else 0) for d in seq]
    mx = max((a + b for a, b in vals), default=0) or 1
    nice = 10 ** math.floor(math.log10(mx)) if mx > 0 else 1
    top = math.ceil(mx / nice) * nice
    bw = (W - pl - 6) / n
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Daily cost">']
    for i in range(5):
        y = pt + (H - pb - pt) * i / 4
        v = top * (1 - i / 4)
        out.append(f'<line x1="{pl}" x2="{W}" y1="{y:.1f}" y2="{y:.1f}" class="grid"/>'
                   f'<text x="{pl - 6}" y="{y + 4:.1f}" class="ax" text-anchor="end">{E(fmt_money(v))}</text>')
    for i, (d, (a, b)) in enumerate(zip(seq, vals)):
        x = pl + i * bw + bw * 0.12
        w = max(bw * 0.76, 1)
        ha = (H - pb - pt) * a / top
        hb = (H - pb - pt) * b / top
        y0 = H - pb
        tip = f"{unit}{d}: Claude {fmt_money(a)}" + (f", Devin {fmt_money(b)}" if b else "")
        out.append(f'<g><title>{E(tip)}</title>'
                   f'<rect x="{x:.1f}" y="{y0 - ha:.1f}" width="{w:.1f}" height="{ha:.1f}" class="c1" rx="1.5"/>'
                   f'<rect x="{x:.1f}" y="{y0 - ha - hb:.1f}" width="{w:.1f}" height="{hb:.1f}" class="c2" rx="1.5"/></g>')
    step = max(1, n // 8)
    for i in range(0, n, step):
        x = pl + i * bw + bw / 2
        out.append(f'<text x="{x:.1f}" y="{H - 6}" class="ax" text-anchor="middle">{seq[i][5:]}</text>')
    out.append("</svg>")
    return "".join(out)


def hbars(items, fmt, cls="c1", extra=None):
    if not items:
        return '<p class="muted">Nothing here.</p>'
    m = max(v for _, v in items) or 1
    rows = []
    for i, (k, v) in enumerate(items):
        ex = f'<span class="muted"> {E(extra(k))}</span>' if extra else ""
        rows.append(f'<div class="hb"><div class="hbl" title="{E(k)}">{E(k)}</div>'
                    f'<div class="hbt"><div class="hbf {cls}" style="width:{v / m * 100:.1f}%"></div></div>'
                    f'<div class="hbv">{E(fmt(v))}{ex}</div></div>')
    return "".join(rows)


def token_mix(S):
    parts = [("Cache read", S["cr"], "t1"), ("Cache write", S["cw5"] + S["cw1h"], "t2"),
             ("Input", S["in"], "t3"), ("Output", S["out"], "t4")]
    tot = sum(v for _, v, _ in parts) or 1
    segs = "".join(f'<div class="{c}" style="width:{v / tot * 100:.2f}%" title="{n}: {fmt_tok(v)}"></div>'
                   for n, v, c in parts if v)
    leg = "".join(f'<span><i class="{c}"></i>{n} <b>{fmt_tok(v)}</b> ({v / tot * 100:.1f}%)</span>'
                  for n, v, c in parts)
    return f'<div class="stack">{segs}</div><div class="legend">{leg}</div>'


def heatmap(S):
    h = S["hours"]
    if not h:
        return '<p class="muted">No prompts.</p>'
    m = max(h.values())
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    cells = ['<div class="hm"><div></div>' + "".join(
        f'<div class="hmh">{x if x % 3 == 0 else ""}</div>' for x in range(24)) + "</div>"]
    for d in range(7):
        row = [f'<div class="hm"><div class="hmd">{days[d]}</div>']
        for x in range(24):
            v = h.get((d, x), 0)
            a = 0 if not v else 0.15 + 0.85 * v / m
            row.append(f'<div class="hmc" style="--a:{a:.2f}" title="{days[d]} {x:02d}:00 — {v} prompts"></div>')
        row.append("</div>")
        cells.append("".join(row))
    return "".join(cells)


def score_class(s):
    if s is None:
        return ""
    return "good" if s >= 75 else "ok" if s >= 55 else "bad"


def session_table(S, pid):
    trs = []
    for r in S["rows"]:
        tools = ", ".join(f"{k} {v}" for k, v in r["tools"].most_common(4)) if r["tools"] else (
            f"{r.get('acus', 0):.1f} ACU · {r.get('prs', 0)} PR · {r.get('status', '')}" if r["source"] == "Devin" else "")
        flags = "".join(f'<span class="flag">{E(f)}</span>' for f in r["flags"])
        sc = r["score"]
        trs.append(
            f'<tr data-src="{r["source"]}">'
            f'<td data-v="{r["start"].timestamp():.0f}">{r["start"].astimezone():%Y-%m-%d %H:%M}</td>'
            f'<td><span class="src {r["source"].lower()}">{r["source"]}</span></td>'
            f'<td class="ttl" title="{E(r["id"])}">{E(r["title"][:90])}{flags}</td>'
            f'<td>{E(r["repo"])}<div class="muted sm">{E(r["branch"][:30])}</div></td>'
            f'<td data-v="{r["dur"]:.0f}">{fmt_dur(r["dur"])}</td>'
            f'<td data-v="{r["prompts"]}">{r["prompts"]}</td>'
            f'<td data-v="{r["tokens"]}">{fmt_tok(r["tokens"])}</td>'
            f'<td data-v="{r["cost"]:.6f}">{fmt_money(r["cost"])}</td>'
            f'<td data-v="{-1 if r["cache_hit"] is None else r["cache_hit"]:.4f}">{pct(r["cache_hit"])}</td>'
            f'<td data-v="{-1 if sc is None else sc}"><span class="pill {score_class(sc)}">{"–" if sc is None else sc}</span></td>'
            f'<td class="sm">{E(r["model"].replace("claude-", ""))}</td>'
            f'<td class="sm muted">{E(tools)}</td></tr>')
    head = ["Started", "Source", "Session", "Repo", "Duration", "Prompts", "Tokens", "Cost",
            "Cache hit", "Score", "Model", "Tools / Devin"]
    ths = "".join(f'<th data-i="{i}">{h}</th>' for i, h in enumerate(head))
    return (f'<div class="tbar"><input type="search" placeholder="Filter sessions, repos, tools…" '
            f'data-t="t-{pid}"><span class="muted sm">{len(S["rows"])} sessions · click a header to sort</span></div>'
            f'<div class="tw"><table id="t-{pid}"><thead><tr>{ths}</tr></thead><tbody>{"".join(trs)}</tbody></table></div>')


def repo_table(S):
    rows = sorted(S["by_repo"].items(), key=lambda kv: (-kv[1]["cost"], kv[0]))
    if not rows:
        return ""
    trs = "".join(
        f'<tr><td>{E(k)}</td><td>{int(v["sessions"])}</td><td>{int(v["prompts"])}</td>'
        f'<td>{fmt_tok(v["tokens"])}</td><td>{fmt_money(v["cost"])}</td>'
        f'<td>{pct(v["cr"] / v["side"]) if v["side"] else "–"}</td>'
        f'<td>{fmt_money(v["cost"] / v["prompts"]) if v["prompts"] else "–"}</td></tr>'
        for k, v in rows[:25])
    return ('<div class="tw"><table class="plain"><thead><tr><th>Repo</th><th>Sessions</th><th>Prompts</th>'
            f'<th>Tokens</th><th>Cost</th><th>Cache hit</th><th>Cost / prompt</th></tr></thead><tbody>{trs}</tbody></table></div>')


def panel(S, pid, label):
    ch = S["cache_hit"]
    ring_c = 2 * math.pi * 52
    ring = (f'<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="52" class="rt"/>'
            f'<circle cx="60" cy="60" r="52" class="rf {score_class(None if ch is None else ch * 100 - 15)}" '
            f'stroke-dasharray="{(ch or 0) * ring_c:.1f} {ring_c:.1f}" transform="rotate(-90 60 60)"/>'
            f'<text x="60" y="66" text-anchor="middle" class="rv">{pct(ch) if ch is not None else "–"}</text></svg>')
    eff = S["efficiency"]
    rng = (f"{S['start'].astimezone():%d %b %Y} – {(S['end'] - timedelta(seconds=1)).astimezone():%d %b %Y}"
           if S["start"] else "Everything on record")
    kpis = [
        ("Total cost", fmt_money(S["cost"]), f"Claude {fmt_money(S['claude_cost'])} · Devin {fmt_money(S['devin_cost'])}"),
        ("Tokens", fmt_tok(S["tokens"]), f"{fmt_tok(S['out'])} output"),
        ("Sessions", f"{S['sessions']:,}", f"{S['claude_sessions']} Claude · {S['devin_sessions']} Devin"),
        ("Prompts", f"{S['prompts']:,}", f"{fmt_money(S['cost'] / S['prompts']) if S['prompts'] else '–'} per prompt"),
        ("Efficiency", f"{eff}/100" if eff is not None else "–", "cost-weighted session score"),
        ("Cache saved", fmt_money(S["cache_saved"]), "vs. paying full input price"),
        ("Tool calls", f"{S['tool_calls']:,}", f"{pct(S['tool_errors'] / S['tool_calls']) if S['tool_calls'] else '–'} failed"),
        ("Devin", f"{S['devin_acus']:.1f} ACU", f"{S['devin_prs']} PRs"),
    ]
    kh = "".join(f'<div class="kpi"><div class="kl">{a}</div><div class="kv">{b}</div><div class="ks">{c}</div></div>'
                 for a, b, c in kpis)
    ins = "".join(f'<li class="{k}">{E(m)}</li>' for k, m in insights(S)) or '<li class="ok">Not enough data yet.</li>'
    models = sorted(S["by_model"].items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    tools = S["tools"].most_common(15)
    return f'''
<section class="panel" id="p-{pid}" data-label="{E(label)}">
  <div class="hero">
    <div class="herol">{ring}<div><div class="kl">Cache hit ratio</div>
      <div class="big">{pct(ch) if ch is not None else "–"}</div>
      <div class="muted">share of input tokens served from cache · {E(rng)}</div></div></div>
    <ul class="ins">{ins}</ul>
  </div>
  <div class="kpis">{kh}</div>
  <div class="grid2">
    <div class="card"><h3>Daily spend</h3><div class="legend"><span><i class="c1"></i>Claude</span><span><i class="c2"></i>Devin</span></div>{svg_daily(S)}</div>
    <div class="card"><h3>Where the tokens went</h3>{token_mix(S)}
      <h3 class="mt">Spend by model</h3>{hbars(models, fmt_money, "c3")}</div>
  </div>
  <div class="grid2">
    <div class="card"><h3>Tools used</h3>{hbars(tools, lambda v: f"{v:,}", "c4", lambda k: f"· {S['tool_err'][k]} failed" if S['tool_err'].get(k) else "")}</div>
    <div class="card"><h3>When you work <span class="muted sm">(prompts by weekday × hour)</span></h3>{heatmap(S)}</div>
  </div>
  <div class="card"><h3>Repos</h3>{repo_table(S)}</div>
  <div class="card"><h3>Sessions</h3>{session_table(S, pid)}</div>
</section>'''


CSS = """
:root{--bg:#f6f7fb;--card:#fff;--fg:#14161f;--mut:#6b7080;--line:#e6e8ef;--c1:#3b6cf6;--c2:#9b5cf6;--c3:#0ea5a4;--c4:#f59e0b;
--t1:#22c55e;--t2:#f59e0b;--t3:#3b6cf6;--t4:#e0457b;--good:#16a34a;--ok:#d97706;--bad:#dc2626;--hm:59,108,246}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0e1017;--card:#171a23;--fg:#e8eaf2;--mut:#9096a8;--line:#272b38;--c1:#6b8fff;--c2:#b48bff;--c3:#2dd4bf;--c4:#fbbf24;--t1:#4ade80;--t2:#fbbf24;--t3:#6b8fff;--t4:#f472b6;--good:#4ade80;--ok:#fbbf24;--bad:#f87171;--hm:107,143,255}}
:root[data-theme=dark]{--bg:#0e1017;--card:#171a23;--fg:#e8eaf2;--mut:#9096a8;--line:#272b38;--c1:#6b8fff;--c2:#b48bff;--c3:#2dd4bf;--c4:#fbbf24;--t1:#4ade80;--t2:#fbbf24;--t3:#6b8fff;--t4:#f472b6;--good:#4ade80;--ok:#fbbf24;--bad:#f87171;--hm:107,143,255}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:24px 16px 60px}header{display:flex;flex-wrap:wrap;gap:12px;align-items:end;justify-content:space-between}
h1{font-size:22px;margin:0}h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:0 0 12px}.mt{margin-top:22px}
.muted{color:var(--mut)}.sm{font-size:12px}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0}
.tabs button{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:7px 14px;border-radius:999px;cursor:pointer;font:inherit}
.tabs button.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}.panel{display:none}.panel.on{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px;min-width:0}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
.herol{display:flex;gap:20px;align-items:center}.ring{width:120px;height:120px;flex:none}.rt{fill:none;stroke:var(--line);stroke-width:12}
.rf{fill:none;stroke:var(--c1);stroke-width:12;stroke-linecap:round}.rf.good{stroke:var(--good)}.rf.ok{stroke:var(--ok)}.rf.bad{stroke:var(--bad)}
.rv{font-size:20px;font-weight:700;fill:var(--fg)}.big{font-size:40px;font-weight:750;letter-spacing:-.02em}
.ins{margin:0;padding:0;list-style:none;display:grid;gap:8px;align-content:center}.ins li{padding-left:16px;position:relative}
.ins li:before{content:"";position:absolute;left:0;top:7px;width:8px;height:8px;border-radius:50%;background:var(--ok)}
.ins li.good:before{background:var(--good)}.ins li.bad:before{background:var(--bad)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}.kl{font-size:12px;color:var(--mut)}
.kv{font-size:24px;font-weight:700;margin:2px 0}.ks{font-size:12px;color:var(--mut)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.grid2>.card{margin-bottom:16px}
.chart{width:100%;height:auto;display:block}.grid{stroke:var(--line)}.ax{font-size:10px;fill:var(--mut)}
.c1{fill:var(--c1);background:var(--c1)}.c2{fill:var(--c2);background:var(--c2)}.c3{background:var(--c3)}.c4{background:var(--c4)}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--mut);margin:8px 0}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.stack{display:flex;height:18px;border-radius:6px;overflow:hidden;background:var(--line)}.t1{background:var(--t1)}.t2{background:var(--t2)}.t3{background:var(--t3)}.t4{background:var(--t4)}
.hb{display:grid;grid-template-columns:minmax(0,150px) 1fr 110px;gap:10px;align-items:center;margin:6px 0;font-size:13px}
.hbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hbt{height:10px;background:var(--line);border-radius:5px;overflow:hidden}.hbf{height:100%;border-radius:5px}.hbv{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px}
.hm{display:grid;grid-template-columns:34px repeat(24,minmax(0,1fr));gap:2px;margin:2px 0}.hmc{aspect-ratio:1;border-radius:3px;background:rgba(var(--hm),var(--a));outline:1px solid var(--line);outline-offset:-1px}
.hmd,.hmh{font-size:10px;color:var(--mut)}
.tbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.tbar input{flex:1;min-width:200px;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{position:sticky;top:0;background:var(--card);text-align:left;font-weight:600;color:var(--mut);cursor:pointer;white-space:nowrap}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}td{font-variant-numeric:tabular-nums}td:first-child{white-space:nowrap}table.plain th{cursor:default}
.ttl{min-width:240px;max-width:380px}.src{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--line)}.src.claude{color:var(--c1)}.src.devin{color:var(--c2)}
.pill{display:inline-block;min-width:34px;text-align:center;padding:1px 8px;border-radius:999px;font-weight:600;background:var(--line)}
.pill.good{color:var(--good)}.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}.flag{display:inline-block;font-size:10px;margin-left:6px;padding:0 6px;border-radius:4px;border:1px solid var(--bad);color:var(--bad)}
details{margin-top:8px}footer{color:var(--mut);font-size:12px;margin-top:20px}
@media (max-width:860px){.hero,.grid2{grid-template-columns:minmax(0,1fr)}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.big{font-size:32px}}
"""

JS = """
const tabs=document.querySelectorAll('.tabs button'),ps=document.querySelectorAll('.panel');
function show(id){tabs.forEach(b=>b.classList.toggle('on',b.dataset.p===id));ps.forEach(p=>p.classList.toggle('on',p.id==='p-'+id));try{localStorage.setItem('aiu-tab',id)}catch(e){}}
tabs.forEach(b=>b.onclick=()=>show(b.dataset.p));let saved=null;try{saved=localStorage.getItem('aiu-tab')}catch(e){}
show(saved&&document.getElementById('p-'+saved)?saved:document.body.dataset.def);
document.querySelectorAll('input[data-t]').forEach(inp=>inp.oninput=()=>{const q=inp.value.toLowerCase();
document.querySelectorAll('#'+inp.dataset.t+' tbody tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none')});
document.querySelectorAll('table:not(.plain) th').forEach(th=>th.onclick=()=>{const t=th.closest('table'),i=+th.dataset.i,b=t.tBodies[0];
const dir=th.dataset.d==='a'?'d':'a';t.querySelectorAll('th').forEach(x=>delete x.dataset.d);th.dataset.d=dir;
const v=tr=>{const c=tr.cells[i];return c.dataset.v!==undefined?+c.dataset.v:c.textContent.trim().toLowerCase()};
[...b.rows].sort((x,y)=>{const a=v(x),c=v(y);return (a>c?1:a<c?-1:0)*(dir==='a'?1:-1)}).forEach(r=>b.appendChild(r))});
"""


def render_html(panels, default_pid, meta):
    tabs = "".join(f'<button data-p="{pid}">{E(label)}</button>' for pid, label, _ in panels)
    body = "".join(panel(S, pid, label) for pid, label, S in panels)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Usage Report</title>
<style>{CSS}</style></head><body data-def="{default_pid}"><div class="wrap">
<header><div><h1>AI Usage Report</h1><div class="muted">Claude Code + Devin · generated {E(meta['generated'])}</div></div>
<div class="muted sm">{E(meta['sources'])}</div></header>
<nav class="tabs">{tabs}</nav>{body}
<div class="card"><h3>How the numbers work</h3><div class="sm">
<p><b>Cache hit ratio</b> = cache-read tokens ÷ all input tokens (fresh input + cache writes + cache reads). Higher is cheaper: cache reads cost 5–10% of normal input.</p>
<p><b>Cost</b> is the API list-price equivalent of the tokens used (on a Pro/Max plan this is the value you got, not what you were billed). Devin cost = ACUs × ${meta['acu_price']:.2f}.</p>
<p><b>Efficiency score (0–100)</b> per Claude session: cache hit ratio (40 pts) + tool success rate (20) + autonomy, i.e. model calls per prompt you typed, capped at 8 (20) + lean context, i.e. average context per call vs 400K (20). The headline score is the cost-weighted average.</p>
<p>Flags: <i>low cache</i> &lt;70% cache hit · <i>tool errors</i> &gt;20% failed · <i>huge context</i> &gt;200K avg · <i>costly prompts</i> &gt;$5 per prompt · <i>many interrupts</i> ≥3.</p>
</div></div>
<footer>{E(meta['footer'])}</footer></div><script>{JS}</script></body></html>"""


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def period_bounds(pid, now_local):
    midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end = midnight + timedelta(days=1)
    days = {"today": 1, "7d": 7, "30d": 30, "90d": 90}.get(pid)
    if days is None:
        return None, None
    return (end - timedelta(days=days)).astimezone(timezone.utc), end.astimezone(timezone.utc)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.normpath(os.path.join(here, "..", "..", "tracker", "ai-usage"))
    ap = argparse.ArgumentParser(description="Claude Code + Devin usage, cost and efficiency report.")
    ap.add_argument("--period", default="30d", choices=[p for p, _ in PERIODS],
                    help="period shown in the terminal and opened first in HTML (default 30d)")
    ap.add_argument("--since", help="custom start date YYYY-MM-DD (adds a Custom tab)")
    ap.add_argument("--until", help="custom end date YYYY-MM-DD, inclusive (default today)")
    ap.add_argument("--claude-dir", action="append", help="extra Claude projects dir (repeatable)")
    ap.add_argument("--devin-file", action="append", help="Devin sessions export, .json or .csv (repeatable)")
    ap.add_argument("--no-devin-api", action="store_true", help="ignore DEVIN_API_KEY")
    ap.add_argument("--acu-price", type=float, default=float(os.environ.get("DEVIN_ACU_PRICE", DEFAULT_ACU_PRICE)))
    ap.add_argument("--pricing", help="JSON file overriding model prices: {model: [in, out, cache_read]}")
    ap.add_argument("--out-dir", default=default_out, help=f"where reports go (default {default_out})")
    ap.add_argument("--no-html", action="store_true", help="skip the HTML report")
    ap.add_argument("--csv", action="store_true", help="also write sessions CSV for the selected period")
    ap.add_argument("--json", action="store_true", help="print the selected period's summary as JSON")
    ap.add_argument("--plain", action="store_true", help="short plain-text summary (cheap for AI chat)")
    ap.add_argument("--top", type=int, default=10, help="sessions listed in the terminal")
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--now", help="reference time (ISO) — for reproducible reports")
    args = ap.parse_args()

    warnings = []
    warn = warnings.append
    if args.pricing:
        for k, v in json.load(open(args.pricing, encoding="utf-8")).items():
            PRICING[k] = tuple(float(x) for x in v)

    now = parse_ts(args.now).astimezone() if args.now else datetime.now().astimezone()
    dirs = claude_dirs(args.claude_dir)
    calls, events, csess, nfiles = load_claude(dirs, warn)
    dsess = load_devin(args, warn)
    if not dirs:
        warn("No Claude Code projects folder found (looked in ~/.claude/projects). Use --claude-dir.")
    if not dsess and not os.environ.get("DEVIN_API_KEY") and not args.devin_file:
        warn("Devin not included: set DEVIN_API_KEY or pass --devin-file <export.json|csv>.")

    periods = []
    for pid, label in PERIODS:
        s, e = period_bounds(pid, now)
        periods.append((pid, label, summarize(calls, events, csess, dsess, s, e)))
    default_pid = args.period
    if args.since:
        tz = now.tzinfo
        s = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=tz)
        u = datetime.strptime(args.until, "%Y-%m-%d").replace(tzinfo=tz) if args.until else now.replace(
            hour=0, minute=0, second=0, microsecond=0)
        e = u + timedelta(days=1)
        label = f"{args.since} → {u:%Y-%m-%d}"
        periods.append(("custom", label, summarize(calls, events, csess, dsess,
                                                   s.astimezone(timezone.utc), e.astimezone(timezone.utc))))
        default_pid = "custom"
    sel = next(p for p in periods if p[0] == default_pid)

    st = Style(sys.stdout.isatty() and not args.no_color and not args.plain and not os.environ.get("NO_COLOR"))
    if args.json:
        S = sel[2]
        print(json.dumps({
            "period": sel[1], "cache_hit_ratio": S["cache_hit"], "efficiency": S["efficiency"],
            "cost_usd": round(S["cost"], 4), "claude_cost_usd": round(S["claude_cost"], 4),
            "devin_cost_usd": round(S["devin_cost"], 4), "devin_acus": S["devin_acus"],
            "tokens": {"input": S["in"], "output": S["out"], "cache_write_5m": S["cw5"],
                       "cache_write_1h": S["cw1h"], "cache_read": S["cr"]},
            "cache_saved_usd": round(S["cache_saved"], 4), "sessions": S["sessions"],
            "prompts": S["prompts"], "tool_calls": S["tool_calls"], "tool_errors": S["tool_errors"],
            "top_tools": S["tools"].most_common(10),
            "by_model": {k: round(v, 4) for k, v in sorted(S["by_model"].items())},
        }, indent=2))
    else:
        print(render_terminal(sel[2], sel[1], st, args.top, args.plain))

    os.makedirs(args.out_dir, exist_ok=True) if (not args.no_html or args.csv) else None
    stamp = now.strftime("%Y-%m-%d")
    if not args.no_html:
        meta = {
            "generated": now.strftime("%Y-%m-%d %H:%M %Z"),
            "sources": f"{nfiles} Claude log files · {len(csess)} Claude sessions · {len(dsess)} Devin sessions",
            "acu_price": args.acu_price,
            "footer": "Generated by skills/scripts/ai-usage-report.py — deterministic, offline. "
                      + (" | ".join(warnings) if warnings else ""),
        }
        path = os.path.join(args.out_dir, f"ai-usage-{stamp}.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(render_html(periods, default_pid, meta))
        print(f"\nHTML report: {path}")
    if args.csv:
        path = os.path.join(args.out_dir, f"ai-usage-sessions-{stamp}-{default_pid}.csv")
        cols = ["start", "end", "source", "id", "title", "repo", "branch", "entry", "duration_min",
                "prompts", "model_calls", "interrupts", "input", "output", "cache_write", "cache_read",
                "tokens", "cost_usd", "cache_hit", "score", "model", "tool_calls", "tool_errors",
                "top_tools", "flags", "devin_acus"]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            for r in sel[2]["rows"]:
                w.writerow([r["start"].astimezone().isoformat(timespec="seconds"),
                            r["end"].astimezone().isoformat(timespec="seconds"), r["source"], r["id"],
                            r["title"], r["repo"], r["branch"], r["entry"], round(r["dur"] / 60, 1),
                            r["prompts"], r["calls"], r["interrupts"], r["in"], r["out"], r["cw"], r["cr"],
                            r["tokens"], round(r["cost"], 4),
                            "" if r["cache_hit"] is None else round(r["cache_hit"], 4),
                            "" if r["score"] is None else r["score"], r["model"], r["tool_calls"],
                            r["tool_err"], "; ".join(f"{k}:{v}" for k, v in r["tools"].most_common(5)),
                            "; ".join(r["flags"]), r.get("acus", "")])
        print(f"Sessions CSV: {path}")
    for wmsg in warnings:
        print(("note: " if args.plain else st("note: ", "33")) + wmsg, file=sys.stderr)


if __name__ == "__main__":
    main()
