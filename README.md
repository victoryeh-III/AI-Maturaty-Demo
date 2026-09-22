# AI Maturity Survey v2

Static website for AI maturity assessment with AI Toolbox recommendations.

## Local development

Open `index.html` directly in a browser, or serve locally:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `ai-maturity-survey`)
2. Run:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

3. Enable Pages in repo Settings → Pages → Source: `main` branch
4. Site will be available at `https://<your-username>.github.io/<repo-name>/`

## Files

- `index.html` - Main survey app
- `toolbox_db.js` - AI tools database (107 tools)
- `survey_data.json` - Survey questions and scoring logic
- `toolbox_raw.csv` - Raw data backup from Google Sheets
