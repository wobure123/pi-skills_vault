---
name: load-skills
description: Browse and install skills from ~/pi-skills_vault into the current project or global pi skills directory. Use when the user wants to load, install, add, list, preview, or browse skills from their vault. Supports symlink (--link) and copy (--copy) modes. Invoke via /skill:load-skills.
---

# load-skills

Browse and install skills from `~/pi-skills_vault`.

## Script Location

The management script is at `scripts/load-skills.sh` relative to this skill directory.
Full path: `~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh`

## Commands

```bash
SCRIPT=~/pi-skills_vault/shared/load-skills/scripts/load-skills.sh

# List all skills in vault (grouped by category)
bash $SCRIPT list

# Preview a specific skill's full SKILL.md
bash $SCRIPT preview coding/git-review

# Install to current project via symlink (default, recommended)
bash $SCRIPT install --link coding/git-review

# Install to current project via copy (for local customization)
bash $SCRIPT install --copy coding/git-review

# Install globally (~/.pi/agent/skills/)
bash $SCRIPT install --link coding/git-review --global
bash $SCRIPT install --copy coding/git-review --global

# Interactive browser (requires fzf, for terminal use)
bash $SCRIPT browse
```

## Workflow

When user asks to load, install, or browse skills:

1. Run `list` → show all available skills grouped by category
2. Present the output clearly to the user
3. If user hasn't specified a skill, ask which one they want
4. Ask: `--link` (symlink, stays in sync with vault) or `--copy` (copy, for customization)?
   - Default suggestion: `--link` unless user says they want to customize
5. Ask: project-level (current `.pi/skills/`) or global (`~/.pi/agent/skills/`)?
   - Default suggestion: project-level
6. Run `install` and confirm success

When user wants to preview a skill:
- Run `preview <category/skill-name>` and show the output

## Handling /skill:load-skills Arguments

When invoked as `/skill:load-skills <args>`, parse the arguments:

- `/skill:load-skills` → run `list` first, then guide the user
- `/skill:load-skills --link coding/git-review` → install with link to current project
- `/skill:load-skills --copy coding/git-review` → install with copy to current project
- `/skill:load-skills --link coding/git-review --global` → install globally
- `/skill:load-skills preview coding/git-review` → preview that skill
- `/skill:load-skills list` → list all skills

## Install Mode Guide

| Mode | Command | When to use |
|------|---------|-------------|
| Symlink | `--link` | Default. Skill stays in sync when vault updates. |
| Copy | `--copy` | When you need to customize the skill for this project only. |

## Scope Guide

| Scope | Location | When to use |
|-------|----------|-------------|
| Project | `.pi/skills/` in cwd | Skill only active in this project. |
| Global | `~/.pi/agent/skills/` | Skill available in all projects. |

## Notes

- Vault location defaults to `~/pi-skills_vault`. Override with `PI_SKILLS_VAULT` env var.
- After installing, pi will discover the skill automatically on next session start.
- To uninstall: `rm ~/.pi/agent/skills/skill-name` (for global) or `rm .pi/skills/skill-name` (for project).
- If `--copy` was used, edit the copy freely — it won't affect the vault original.
