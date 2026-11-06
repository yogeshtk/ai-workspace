#!/usr/bin/env node
/*
 * diagram-cli.js — edit and render diagram JSON files from the command line (Node 16+).
 *
 *   node tools/diagram/diagram-cli.js <command> [args]
 *
 * Commands
 *   new <file.json> [--title "T"] [--dir TB|LR]   create an empty diagram (refuses to overwrite)
 *   show <file.json>                              print an outline: nodes, edges, positions
 *   apply <file.json> <ops>                       apply operations; <ops> is a .json file, '-' (stdin),
 *                                                 or inline JSON like '[{"op":"addNode",...}]'
 *   layout <file.json> [--dir TB|LR]              re-run auto-layout
 *   validate <file.json>                          check ids and references
 *   svg <file.json> [out.svg]                     export SVG (default: same name, .svg)
 *   html <file.json> [out.html]                   export a standalone HTML page (JSON embedded)
 *   json <file.html> [out.json]                   recover the diagram JSON from an exported HTML page
 *   editor <file.json> [out.html]                 single-file editor (all scripts inlined) with this diagram loaded
 *   guide                                         print the AI editing guide (schema + ops)
 *
 * All edits are atomic: if any op fails, the file is left untouched.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require('./diagram-core.js');

function fail(msg) { console.error('Error: ' + msg); process.exit(1); }
function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function readDiagram(file) {
  if (!file) fail('missing diagram file');
  if (!fs.existsSync(file)) fail(`file not found: ${file}`);
  try { return new Core.Diagram(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`${file}: ${e.message}`); }
}
function write(file, d) {
  fs.writeFileSync(file, file.endsWith('.html') ? d.toHTML() : d.toString());
}
function swapExt(file, ext) { return file.replace(/\.(json|html?)$/i, '') + ext; }
function readStdin() { return fs.readFileSync(0, 'utf8'); }

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case 'new': {
    const title = flag(args, '--title');
    const dir = flag(args, '--dir');
    const file = args[0];
    if (!file) fail('usage: new <file.json> [--title "T"] [--dir TB|LR]');
    if (fs.existsSync(file)) fail(`${file} already exists (not overwriting)`);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const d = new Core.Diagram({ meta: { title: title || path.basename(file, '.json').replace(/-/g, ' '), direction: (dir || 'TB').toUpperCase() } });
    write(file, d);
    console.log(`Created ${file}`);
    break;
  }
  case 'show': {
    const d = readDiagram(args[0]);
    console.log(d.summary());
    const problems = d.validate();
    if (problems.length) console.log('Problems:\n  ' + problems.join('\n  '));
    break;
  }
  case 'apply': {
    const [file, src] = args;
    if (!file || !src) fail('usage: apply <file.json> <ops.json | - | \'[...]\'>');
    const d = readDiagram(file);
    let text;
    if (src === '-') text = readStdin();
    else if (/^\s*[[{]/.test(src)) text = src;
    else if (fs.existsSync(src)) text = fs.readFileSync(src, 'utf8');
    else fail(`ops not found: ${src}`);
    let results;
    try { results = d.applyOps(text); }
    catch (e) { fail(`${e.message}\nNo changes were written.`); }
    const problems = d.validate();
    if (problems.length) fail('result is invalid, not written:\n  ' + problems.join('\n  '));
    write(file, d);
    console.log(`Applied ${results.length} op(s) to ${file}: ${results.join(', ')}`);
    console.log(`Now ${d.nodes.length} nodes, ${d.edges.length} edges.`);
    break;
  }
  case 'layout': {
    const dir = flag(args, '--dir');
    const d = readDiagram(args[0]);
    d.layout(dir ? { direction: dir } : {});
    write(args[0], d);
    console.log(`Laid out ${args[0]} (${d.meta.direction})`);
    break;
  }
  case 'validate': {
    const d = readDiagram(args[0]);
    const problems = d.validate();
    if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
    console.log(`OK — ${d.nodes.length} nodes, ${d.edges.length} edges`);
    break;
  }
  case 'svg':
  case 'html':
  case 'json': {
    const d = readDiagram(args[0]);
    const out = args[1] || swapExt(args[0], '.' + cmd);
    if (path.resolve(out) === path.resolve(args[0])) fail('output would overwrite the input');
    if (cmd === 'json' && fs.existsSync(out)) fail(`${out} already exists (not overwriting)`);
    fs.writeFileSync(out, cmd === 'svg' ? d.toSVG() : cmd === 'json' ? d.toString() : d.toHTML());
    console.log(`Wrote ${out}`);
    break;
  }
  case 'editor': {
    const d = readDiagram(args[0]);
    const out = args[1] || swapExt(args[0], '-editor.html');
    if (path.resolve(out) === path.resolve(args[0])) fail('output would overwrite the input');
    const dir = __dirname;
    const inline = (name) => '<script>\n' + fs.readFileSync(path.join(dir, name), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>';
    const preset = JSON.stringify(d.toJSON()).replace(/</g, '\\u003c');
    const key = 'json-diagram-editor:' + (Core.slug(d.meta.title) || 'diagram');
    let html = fs.readFileSync(path.join(dir, 'diagram.html'), 'utf8')
      .replace('<script src="diagram-core.js"></script>', () => `<script>window.DIAGRAM_PRESET = ${preset}; window.DIAGRAM_STORE_KEY = ${JSON.stringify(key)};</script>\n` + inline('diagram-core.js'))
      .replace('<script src="diagram-view.js"></script>', () => inline('diagram-view.js'));
    fs.writeFileSync(out, html);
    console.log(`Wrote ${out}`);
    break;
  }
  case 'guide':
    console.log(Core.AI_GUIDE);
    break;
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).map((l) => l.replace(/^ \*? ?/, '')).join('\n'));
    if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
}
