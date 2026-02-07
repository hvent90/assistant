# Google Calendar Setup

Follow these steps to set up Google Calendar access. You (the agent) should
execute every command you can directly. Only ask the user when a step
requires their browser.

## Phase 1: Install gog CLI

Run:

```bash
brew install steipete/tap/gogcli
```

Verify:

```bash
gog --version
```

If brew is not available or install fails, check https://github.com/steipete/gogcli
for alternative install methods.

## Phase 2: Google Cloud Project

This phase requires the user's browser. Walk them through each step via
Discord, one at a time:

1. Go to https://console.cloud.google.com/ and create a new project
   (or reuse an existing one). Name suggestion: "Assistant Calendar"
2. In the project, go to APIs & Services > Library. Search for
   "Google Calendar API" and enable it.
3. Go to APIs & Services > OAuth consent screen.
   - Choose "External" user type
   - Fill in app name (e.g. "Assistant"), user support email, and
     developer contact email (all can be the user's email)
   - On the Scopes page, add `https://www.googleapis.com/auth/calendar`
   - On the Test users page, add the user's Google email
   - Save and continue through the remaining steps
4. Go to APIs & Services > Credentials.
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: "Desktop app"
   - Name: "Assistant CLI"
   - Click Create, then download the JSON file
5. Ask the user for the path to the downloaded JSON file.

## Phase 3: Authenticate

Run (replace path with the actual file the user provided):

```bash
gog auth credentials ~/Downloads/client_secret_XXXX.json
```

Then tell the user you need them to complete a browser sign-in, and run:

```bash
gog auth add USER_EMAIL --services calendar
```

This opens a browser window for Google consent. Tell the user to complete
the sign-in and grant calendar access.

## Phase 4: Verify

Run:

```bash
gog calendar events primary --today --json
```

If this returns events (or an empty list with no error), setup is complete.
If it returns an auth error, re-run Phase 3.
