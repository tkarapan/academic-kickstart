# tkarap.com [![Netlify Status](https://api.netlify.com/api/v1/badges/0e545801-34a8-40e6-99c5-d2af1a6a5869/deploy-status)](https://app.netlify.com/sites/tkarap/deploys)

Source for [www.tkarap.com](https://www.tkarap.com/), built with [Hugo](https://gohugo.io/) and deployed by Netlify. The site design lives in this repository (`layouts/`, `assets/`), so builds do not depend on any external theme.

## Where things are

| What | File |
| --- | --- |
| Biography | `content/_index.md` |
| Name, role, tagline, contact details, social links | `hugo.toml` |
| Research interests and education | `data/profile.yaml` |
| Experience | `data/experience.yaml` |
| Publications | `content/publication/<name>/index.md` (+ optional `cite.bib`, `featured.png`) |
| Portrait | `assets/img/avatar.png` |

## Publications

**Automatic updates.** Every Monday a GitHub Action (`.github/workflows/publications.yml`) checks ORCID and Crossref for new journal articles. If it finds any, it opens a pull request with draft pages. Review the Netlify preview, edit if needed, and merge to publish. Closing the pull request without merging skips those papers permanently. The check can also be run by hand from the *Actions* tab (*Check for new publications* → *Run workflow*).

**Adding one by hand.** Create a folder in `content/publication/` containing an `index.md`:

```toml
+++
title = "Paper title"
date = 2026-01-31
authors = ["First Author", "admin", "Last Author"]   # "admin" = me, highlighted
publication_types = ["2"]   # 2 journal article, 3 preprint, 7 thesis
abstract = "..."
featured = false            # true = show under Featured publications
publication = "*Journal name*"
doi = "10.xxxx/xxxxx"
url_pdf = ""                # optional
+++
```

Optionally add `cite.bib` (offered as the *Cite* download) and `featured.png` (shown on featured cards and the paper's page).

The news ticker on the home page is generated from the most recent publications.

**Figures.** Publications without a `featured.*` image get one automatically when an openly licensed version is in PubMed Central (graphical abstract or Figure 1, credited on the page). To use a different figure, replace `featured.*` in the paper's folder; to have none, add `figure = false` to its `index.md`.

## Citation figures

`data/metrics.json` holds total citations and h-index from Google Scholar. A GitHub Action (`.github/workflows/metrics.yml`) refreshes it on the 1st of each month. Google Scholar sometimes refuses automated requests; the stored figures are then kept, and if they are more than three months old an issue is opened as a reminder. To update by hand, edit the file on GitHub:

```json
{
  "citations": 3100,
  "h_index": 24,
  "source": "Google Scholar",
  "updated": "2026-12-01"
}
```

## Images

The site only publishes resized copies of images, never the original files. An Action (`.github/workflows/image-metadata.yml`) also removes embedded metadata (camera details, GPS location) from any image pushed to the repository and opens an issue when it does. To clean images before committing:

```bash
python3 scripts/strip_image_metadata.py
```

## Previewing locally

```bash
hugo server
```

Then open http://localhost:1313. Every pull request also gets a Netlify deploy preview.
