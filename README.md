# pi-skills_vault

Personal pi skills library. One source of truth for all skills.

## Structure

```
pi-skills_vault/
├── shared/       # General-purpose skills (available everywhere)
├── coding/       # Programming, code review, debugging
├── office/       # Document writing, spreadsheets, presentations
├── business/     # Research, analysis, meeting notes
└── life/         # Travel, habits, personal productivity
```

## Quick Start

### Load the load-skills skill globally (do this once)

```bash
mkdir -p ~/.pi/agent/skills
ln -s ~/pi-skills_vault/shared/load-skills ~/.pi/agent/skills/load-skills
```

After that, use `/skill:load-skills` in any pi session to browse and install skills.

### Manual install

```bash
# Link a skill into current project
~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh install --link coding/git-review

# Copy a skill (for project customization)
~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh install --copy coding/git-review

# Install globally
~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh install --link coding/git-review --global

# Browse interactively (requires fzf)
~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh browse
```

## Sync with GitHub

```bash
cd ~/pi-skills_vault
git init
git remote add origin git@github.com:YOU/pi-skills_vault.git
git add .
git commit -m "init vault"
git push -u origin main
```

## Naming Convention

- Directory name = skill name = `name` in SKILL.md frontmatter
- Use lowercase letters, numbers, hyphens only
- Example: `git-review`, `python-debug`, `doc-writing`
