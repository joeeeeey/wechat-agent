# Project instructions

One WeChat File Helper controls one machine. Keep the runtime provider-neutral.
Never operate an existing user's WeChat browser while developing or testing.
Use isolated local DOM fixtures. Keep login state, QR codes, credentials and
transcripts outside the repo. Do not add automatic reload/recovery/replay loops.
Run npm test and the skill validator for relevant changes. Report live-test gaps.
The future rescue channel must be authenticated; it is not implemented yet.
