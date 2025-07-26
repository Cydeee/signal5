# .github/workflows/alert.yml
name: telegram-alert

permissions:
  contents: read

on:
  # 1) Run whenever you push new code to main
  push:
    branches:
      - main

  # 2) Manual trigger in the Actions UI
  workflow_dispatch:

  # 3) Every 15 minutes
  schedule:
    - cron: "*/15 * * * *"

jobs:
  alert:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout bot code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Run Telegram alert
        run: |
          echo "▶ node .github/scripts/alert.js"
          node .github/scripts/alert.js
        env:
          BOT_TOKEN:  ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT_ID:    ${{ secrets.TELEGRAM_CHAT_ID }}
          LIVE_URL:   "https://btcsignal.netlify.app/data.json"
          TEST_ALERT: "0"
