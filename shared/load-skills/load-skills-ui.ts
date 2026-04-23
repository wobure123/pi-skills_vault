/**
 * load-skills-ui.ts
 *
 * Pi extension: /load-skills command with interactive TUI picker
 *
 * Usage:
 *   /load-skills              → open TUI picker (browse categories → skills → preview)
 *   /load-skills list         → print vault list (no TUI)
 *   /load-skills preview coding/git-review
 *   /load-skills --link coding/git-review
 *   /load-skills --copy coding/git-review --global
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
  Spacer,
  matchesKey,
  Key,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────

const VAULT = process.env.PI_SKILLS_VAULT || join(homedir(), "pi-skills_vault");
const SCRIPT = join(VAULT, "shared/load-skills/scripts/load-skills.sh");

// ── Data types ───────────────────────────────────────────────────────────────

interface Skill {
  category: string;
  name: string;
  path: string;   // "category/name"
  absDir: string;
  description: string;
}

// ── Vault reader ─────────────────────────────────────────────────────────────

function parseDescription(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const fm = match[1];
  const inline = fm.match(/^description:\s*(.+)/m);
  if (!inline) return "";
  let desc = inline[1].trim();
  // YAML block scalar: |  |-  >
  if (/^[|>]-?$/.test(desc)) {
    const afterTag = content.slice(content.indexOf(desc) + desc.length);
    for (const line of afterTag.split("\n")) {
      const t = line.trim();
      if (t) return t;
    }
    return "";
  }
  return desc;
}

function loadSkills(): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(VAULT)) return skills;

  let categories: string[];
  try {
    categories = readdirSync(VAULT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
  } catch {
    return skills;
  }

  for (const cat of categories) {
    const catDir = join(VAULT, cat);
    let names: string[];
    try {
      names = readdirSync(catDir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }

    for (const name of names) {
      const absDir = join(catDir, name);
      const skillMd = join(absDir, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      let content = "";
      try { content = readFileSync(skillMd, "utf8"); } catch { continue; }
      skills.push({ category: cat, name, path: `${cat}/${name}`, absDir, description: parseDescription(content) });
    }
  }
  return skills;
}

// ── Skill Picker (custom TUI component) ──────────────────────────────────────

function wrapText(text: string, width: number): string[] {
  if (!text || width <= 0) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= width) {
      cur += " " + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

class SkillPicker {
  private skills: Skill[];
  private idx = 0;
  private theme: any;
  private cachedWidth?: number;
  private cachedLines?: string[];

  public onSelect?: (skill: Skill) => void;
  public onCancel?: () => void;

  constructor(skills: Skill[], theme: any) {
    this.skills = skills;
    this.theme = theme;
  }

  private get current(): Skill | undefined {
    return this.skills[this.idx];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
      if (this.idx > 0) { this.idx--; this.invalidate(); }
    } else if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
      if (this.idx < this.skills.length - 1) { this.idx++; this.invalidate(); }
    } else if (matchesKey(data, Key.enter)) {
      if (this.current) this.onSelect?.(this.current);
    } else if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const t = this.theme;
    const lines: string[] = [];
    const inner = Math.max(10, width - 2);
    const current = this.current;

    // ── Title ────────────────────────────────────────────
    lines.push(truncateToWidth(`  ${t.fg("accent", t.bold("📦 pi-skills_vault"))}  ${t.fg("dim", VAULT)}`, width));
    lines.push("");

    // ── Skill list grouped by category ───────────────────
    let lastCat = "";
    for (const skill of this.skills) {
      if (skill.category !== lastCat) {
        if (lastCat !== "") lines.push("");
        lines.push(truncateToWidth(`  ${t.fg("accent", `[${skill.category}]`)}`, width));
        lastCat = skill.category;
      }
      const isSel = skill.path === current?.path;
      if (isSel) {
        // Selected: full row highlight, no inline desc (preview is below)
        const row = `  ${t.fg("accent", "▶")} ${t.fg("accent", t.bold(skill.name))}`;
        lines.push(truncateToWidth(row, width));
      } else {
        // Normal: name + truncated description
        const nameLen = skill.name.length;
        const maxDesc = Math.max(0, inner - 4 - nameLen - 2);
        const desc = skill.description.slice(0, maxDesc);
        lines.push(truncateToWidth(`    ${skill.name}  ${t.fg("dim", desc)}`, width));
      }
    }

    // ── Preview panel ─────────────────────────────────────
    lines.push("");
    lines.push(truncateToWidth(`  ${t.fg("dim", "─".repeat(Math.max(0, inner)))}`, width));
    lines.push("");

    if (current) {
      lines.push(truncateToWidth(
        `  ${t.fg("accent", t.bold(current.name))}  ${t.fg("muted", current.path)}`,
        width
      ));
      if (current.description) {
        lines.push("");
        const wrapped = wrapText(current.description, inner - 2);
        for (const line of wrapped.slice(0, 3)) {
          lines.push(truncateToWidth(`  ${t.fg("muted", line)}`, width));
        }
      }
    } else {
      lines.push(truncateToWidth(`  ${t.fg("dim", "(no skills found)")}`, width));
    }

    // ── Help row ──────────────────────────────────────────
    lines.push("");
    lines.push(truncateToWidth(
      `  ${t.fg("dim", "↑↓ / Tab navigate   Enter select   Esc cancel")}`,
      width
    ));
    lines.push("");

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }
}

// ── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("load-skills", {
    description: "Browse and install skills from ~/pi-skills_vault (opens interactive picker)",
    handler: async (args, ctx) => {
      const argv = (args || "").trim().split(/\s+/).filter(Boolean);

      // ── Direct pass-through commands (no TUI) ────────────
      if (argv[0] === "list") {
        const r = spawnSync("bash", [SCRIPT, "list"], { encoding: "utf8" });
        ctx.ui.notify(r.stdout || r.stderr || "(empty)", "info");
        return;
      }
      if (argv[0] === "preview" && argv[1]) {
        const r = spawnSync("bash", [SCRIPT, "preview", argv[1]], { encoding: "utf8" });
        ctx.ui.notify(r.stdout || r.stderr, "info");
        return;
      }
      if ((argv[0] === "--link" || argv[0] === "--copy") && argv[1]) {
        const extras = argv.slice(2);
        const r = spawnSync("bash", [SCRIPT, "install", argv[0], argv[1], ...extras], { encoding: "utf8" });
        ctx.ui.notify((r.stdout + r.stderr).trim() || "done", r.status === 0 ? "success" : "error");
        return;
      }

      // ── Load vault ────────────────────────────────────────
      const skills = loadSkills();
      if (skills.length === 0) {
        ctx.ui.notify(`No skills found in: ${VAULT}`, "warning");
        return;
      }

      // ── Phase 1: pick a skill ─────────────────────────────
      const selectedSkill = await ctx.ui.custom<Skill | null>(
        (tui, theme, _kb, done) => {
          const picker = new SkillPicker(skills, theme);
          picker.onSelect = (s) => done(s);
          picker.onCancel = () => done(null);
          return {
            render: (w) => picker.render(w),
            invalidate: () => picker.invalidate(),
            handleInput: (data) => { picker.handleInput(data); tui.requestRender(); },
          };
        },
        { overlay: true, overlayOptions: { width: "65%", maxHeight: "85%", anchor: "center" } }
      );
      if (!selectedSkill) return;

      // ── Phase 2: link or copy ─────────────────────────────
      const modeItems: SelectItem[] = [
        { value: "--link", label: "Link (symlink)", description: "Stays in sync with vault on update" },
        { value: "--copy", label: "Copy",           description: "Local copy — safe to customize for this project" },
      ];
      const selectedMode = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(new Text(
            `${theme.fg("accent", theme.bold("Install mode"))}  ${theme.fg("dim", selectedSkill.path)}`, 1, 0
          ));
          container.addChild(new Spacer(1));
          const list = new SelectList(modeItems, 4, {
            selectedPrefix: (s) => theme.fg("accent", s),
            selectedText:   (s) => theme.fg("accent", s),
            description:    (s) => theme.fg("muted", s),
          });
          list.onSelect = (item) => done(item.value);
          list.onCancel = () => done(null);
          container.addChild(list);
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", "↑↓ navigate   Enter select   Esc cancel"), 1, 0));
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => { list.handleInput(data); tui.requestRender(); },
          };
        },
        { overlay: true, overlayOptions: { width: "50%", anchor: "center" } }
      );
      if (!selectedMode) return;

      // ── Phase 3: project or global ────────────────────────
      const scopeItems: SelectItem[] = [
        { value: "--project", label: "Project", description: `${ctx.cwd}/.pi/skills/  (this project only)` },
        { value: "--global",  label: "Global",  description: "~/.pi/agent/skills/  (all projects)" },
      ];
      const selectedScope = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(new Text(
            `${theme.fg("accent", theme.bold("Install scope"))}  ${theme.fg("dim", selectedSkill.name)}`, 1, 0
          ));
          container.addChild(new Spacer(1));
          const list = new SelectList(scopeItems, 4, {
            selectedPrefix: (s) => theme.fg("accent", s),
            selectedText:   (s) => theme.fg("accent", s),
            description:    (s) => theme.fg("muted", s),
          });
          list.onSelect = (item) => done(item.value);
          list.onCancel = () => done(null);
          container.addChild(list);
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", "↑↓ navigate   Enter select   Esc cancel"), 1, 0));
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => { list.handleInput(data); tui.requestRender(); },
          };
        },
        { overlay: true, overlayOptions: { width: "50%", anchor: "center" } }
      );
      if (!selectedScope) return;

      // ── Execute install ───────────────────────────────────
      const r = spawnSync(
        "bash",
        [SCRIPT, "install", selectedMode, selectedSkill.path, selectedScope],
        { encoding: "utf8" }
      );
      const msg = (r.stdout + r.stderr).trim();
      ctx.ui.notify(msg || "Done!", r.status === 0 ? "success" : "error");
    },
  });
}
