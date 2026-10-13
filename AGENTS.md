# Project instructions

One WeChat File Helper controls one machine. Keep the runtime provider-neutral.
Never operate an existing user's WeChat browser while developing or testing.
Use isolated local DOM fixtures. Keep login state, QR codes, credentials and
transcripts outside the repo. Do not add automatic reload/recovery/replay loops.
Run npm test and the skill validator for relevant changes. Report live-test gaps.
The rescue status channel must remain authenticated. See docs/rescue.md; remote QR rescue is opt-in and uses the existing login page plus a durable intake gate. Use fixtures for development; an owner-requested live integration may verify real selectors and scan recovery. Never treat fixtures as live login acceptance.
