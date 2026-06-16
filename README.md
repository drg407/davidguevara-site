# davidguevara.dev

Personal site and app privacy policies.

## Structure

```
index.html              → davidguevara.dev
litescraper/
  icon.png              → liteScraper app icon
  privacy/index.html    → davidguevara.dev/litescraper/privacy/
vr/                     → davidguevara.dev/vr/
```

## Apps

- **liteScraper** — macOS movie library organizer for Jellyfin · [Privacy Policy](https://davidguevara.dev/litescraper/privacy/)
- **liteFin** — tvOS Jellyfin client · [App Store](https://apps.apple.com/us/app/litefin/id6777851924) · [Privacy Policy](https://davidguevara.dev/litefin/privacy)

## Deploy

Pushes to `main` auto-deploy to Namecheap via GitHub Actions (FTP).
To deploy manually:

```bash
lftp -c "
set ssl:verify-certificate no;
set ftp:passive-mode yes;
open -u 'claude@davidguevara.dev','<password>' ftp://ftp.davidguevara.dev;
mirror -R --verbose \
  --exclude-glob .git \
  --exclude-glob .github \
  --exclude-glob .DS_Store \
  --exclude-glob .gitignore \
  /path/to/davidguevara-site/ /;
quit"
```
