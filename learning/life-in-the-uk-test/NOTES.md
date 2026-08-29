# Notes

- Workspace lives at `learning/life-in-the-uk-test/` (repo root), following the same convention established for the Spring Boot/Docker workspace.
- `assets/style.css` and `assets/quiz.js` were seeded from the Spring Boot/Docker workspace's proven components, unchanged — same Tufte-style design system, same retrieval-practice quiz widget contract.
- Important integrity constraint: the test draws questions ONLY from the official Home Office handbook, 3rd edition. Resist the temptation to add "interesting UK facts" that aren't in scope for the actual test — it wastes the user's limited study time and risks teaching wrong content as if it were test-relevant.
- Direct fetch of gov.uk is blocked by this session's network egress policy — verified facts via search/secondary sources instead. Should re-verify directly against gov.uk once reachable, or ask the user to confirm current fee/format since these do get updated periodically.
- User's starting point: everyday UK life gave them cultural/practical familiarity, but NOT the specific historical dates/figures/facts the test drills on — that's the identified weak spot and where lessons should concentrate first, rather than re-teaching things they already know from living there.
- Timeline: 1-3 months before booking — steady pace, not cram, but not unlimited runway either.
