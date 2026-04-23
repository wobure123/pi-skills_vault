/**
 * load-skills-ui.ts
 *
 * Pi extension: /load-skills command with interactive TUI picker.
 * Manages both skills and extensions from ~/pi-skills_vault.
 *
 * Usage:
 *   /load-skills                             → open TUI picker
 *   /load-skills list                        → print vault list (no TUI)
 *   /load-skills preview coding/boss
 *   /load-skills preview extensions/load-skills-ui.ts
 *   /load-skills --link coding/boss
 *   /load-skills --link extensions/load-skills-ui.ts --global
 *   /load-skills --copy coding/boss --global
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
} from "@mariozechner/pi-tui";

// ── Config ───────────────────────────────────────────────────────────────────

const VAULT = process.env.PI_SKILLS_VAULT || join(homedir(), "pi-skills_vault");
const SCRIPT = join(VAULT, "shared/load-skills/scripts/load-skills.sh");

// ── Data types ────────────────────────────────────────────────────────────────

type EntryKind = "skill" | "extension";

interface VaultEntry {
  kind: EntryKind;
  category: string;   // e.g. "coding", "extensions"
  name: string;       // display name (no .ts suffix for extensions)
  path: string;       // vault-relative: "coding/boss" or "extensions/load-skills-ui.ts"
  absPath: string;    // absolute path
  description: string;
}

// ── Vault reader ──────────────────────────────────────────────────────────────

function parseSkillDescription(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const fm = match[1];
  const inline = fm.match(/^description:\s*(.+)/m);
  if (!inline) return "";
  let desc = inline[1].trim();
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

function parseExtDescription(content: string): string {
  const m1 = content.match(/Pi extension:\s*(.+)/);
  if (m1) return m1[1].trim();
  const m2 = content.match(/\/\*\*[\s\S]*?\*\s+([^*\n@][^\n]+)/);
  if (m2) return m2[1].trim();
  const m3 = content.match(/^\/\/\s*(.+)/m);
  if (m3) return m3[1].trim();
  return "";
}

function loadVault(): VaultEntry[] {
  const entries: VaultEntry[] = [];
  if (!existsSync(VAULT)) return entries;

  let categories: string[];
  try {
    categories = readdirSync(VAULT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => {
        if (a === "extensions") return -1;
        if (b === "extensions") return 1;
        return a.localeCompare(b);
      });
  } catch {
    return entries;
  }

  for (const cat of categories) {
    const catDir = join(VAULT, cat);

    if (cat === "extensions") {
      let files: string[];
      try {
        files = readdirSync(catDir)
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
          .sort();
      } catch { continue; }
      for (const file of files) {
        const absPath = join(catDir, file);
        let content = "";
        try { content = readFileSync(absPath, "utf8"); } catch { continue; }
        entries.push({
          kind: "extension",
          category: cat,
          name: file.replace(/\.ts$/, ""),
          path: `extensions/${file}`,
          absPath,
          description: parseExtDescription(content),
        });
      }
    } else {
      let names: string[];
      try {
        names = readdirSync(catDir, { withFileTypes: true })
          .filter((d) => !d.name.startsWith("."))
          .map((d) => d.name)
          .sort();
      } catch { continue; }
      for (const name of names) {
        const absPath = join(catDir, name);
        const skillMd = join(absPath, "SKILL.md");
        if (!existsSync(skillMd)) continue;
        let content = "";
        try { content = readFileSync(skillMd, "utf8"); } catch { continue; }
        entries.push({
          kind: "skill",
          category: cat,
          name,
          path: `${cat}/${name}`,
          absPath,
          description: parseSkillDescription(content),
        });
      }
    }
  }
  return entries;
}

// ── Vault Picker (custom TUI component) ───────────────────────────────────────

function wrapText(text: string, width: number): string[] {
  if (!text || width <= 0) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (!cur) { cur = word; }
    else if (cur.length + 1 + word.length <= width) { cur += " " + word; }
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

class VaultPicker {
  private entries: VaultEntry[];
  private idx = 0;
  private theme: any;
  private cachedWidth?: number;
  private cachedLines?: string[];

  public onSelect?: (entry: VaultEntry) => void;
  public onCancel?: () => void;

  constructor(entries: VaultEntry[], theme: any) {
    this.entries = entries;
    this.theme = theme;
  }

  private get current(): VaultEntry | undefined {
    return this.entries[this.idx];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
      if (this.idx > 0) { this.idx--; this.invalidate(); }
    } else if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
      if (this.idx < this.entries.length - 1) { this.idx++; this.invalidate(); }
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

    lines.push(truncateToWidth(`  ${t.fg("accent", t.bold("📦 pi-skills_vault"))}  ${t.fg("dim", VAULT)}`, width));
    lines.push("");

    // ── List grouped by category ───────────────────────────────
    let lastCat = "";
    for (const entry of this.entries) {
      if (entry.category !== lastCat) {
        if (lastCat !== "") lines.push("");
        const catColor = entry.kind === "extension" ? "warning" : "accent";
        lines.push(truncateToWidth(`  ${t.fg(catColor, `[${entry.category}]`)}`, width));
        lastCat = entry.category;
      }
      const isSel = entry.path === current?.path;
      if (isSel) {
        lines.push(truncateToWidth(`  ${t.fg("accent", "▶")} ${t.fg("accent", t.bold(entry.name))}`, width));
      } else {
        const maxDesc = Math.max(0, inner - 4 - entry.name.length - 2);
        const desc = entry.description.slice(0, maxDesc);
        lines.push(truncateToWidth(`    ${entry.name}  ${t.fg("dim", desc)}`, width));
      }
    }

    // ── Preview panel ──────────────────────────────────────────
    lines.push("");
    lines.push(truncateToWidth(`  ${t.fg("dim", "─".repeat(Math.max(0, inner)))}`, width));
    lines.push("");

    if (current) {
      const badge = current.kind === "extension"
        ? t.fg("warning", "[ext]")
        : t.fg("accent", "[skill]");
      lines.push(truncateToWidth(
        `  ${badge}  ${t.fg("accent", t.bold(current.name))}  ${t.fg("dim", current.path)}`,
        width
      ));
      if (current.description) {
        lines.push("");
        for (const line of wrapText(current.description, inner - 2).slice(0, 3)) {
          lines.push(truncateToWidth(`  ${t.fg("muted", line)}`, width));
        }
      }
    } else {
      lines.push(truncateToWidth(`  ${t.fg("dim", "(vault is empty)")}`, width));
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${t.fg("dim", "↑↓ / Tab navigate   Enter select   Esc cancel")}`, width));
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

// ── Shared: mode + scope pickers ─────────────────────────────────────────────

async function pickMode(label: string, ctx: any): Promise<string | null> {
  const items: SelectItem[] = [
    { value: "--link", label: "Link (symlink)", description: "Stays in sync with vault on update" },
    { value: "--copy", label: "Copy",           description: "Local copy — safe to customize" },
  ];
  return ctx.ui.custom<string | null>(
    (tui: any, theme: any, _kb: any, done: any) => {
      const c = new Container();
      c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      c.addChild(new Text(`${theme.fg("accent", theme.bold("Install mode"))}  ${theme.fg("dim", label)}`, 1, 0));
      c.addChild(new Spacer(1));
      const list = new SelectList(items, 4, {
        selectedPrefix: (s) => theme.fg("accent", s),
        selectedText:   (s) => theme.fg("accent", s),
        description:    (s) => theme.fg("muted", s),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(null);
      c.addChild(list);
      c.addChild(new Spacer(1));
      c.addChild(new Text(theme.fg("dim", "↑↓ navigate   Enter select   Esc cancel"), 1, 0));
      c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      return {
        render: (w: number) => c.render(w),
        invalidate: () => c.invalidate(),
        handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
      };
    },
    { overlay: true, overlayOptions: { width: "50%", anchor: "center" } }
  );
}

async function pickScope(entry: VaultEntry, ctx: any): Promise<string | null> {
  const isExt = entry.kind === "extension";
  const items: SelectItem[] = [
    {
      value: "--project",
      label: "Project",
      description: isExt
        ? `${ctx.cwd}/.pi/extensions/  (this project only)`
        : `${ctx.cwd}/.pi/skills/  (this project only)`,
    },
    {
      value: "--global",
      label: "Global",
      description: isExt
        ? "~/.pi/agent/extensions/  (all projects)"
        : "~/.pi/agent/skills/  (all projects)",
    },
  ];
  return ctx.ui.custom<string | null>(
    (tui: any, theme: any, _kb: any, done: any) => {
      const c = new Container();
      c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      c.addChild(new Text(`${theme.fg("accent", theme.bold("Install scope"))}  ${theme.fg("dim", entry.name)}`, 1, 0));
      c.addChild(new Spacer(1));
      const list = new SelectList(items, 4, {
        selectedPrefix: (s) => theme.fg("accent", s),
        selectedText:   (s) => theme.fg("accent", s),
        description:    (s) => theme.fg("muted", s),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(null);
      c.addChild(list);
      c.addChild(new Spacer(1));
      c.addChild(new Text(theme.fg("dim", "↑↓ navigate   Enter select   Esc cancel"), 1, 0));
      c.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      return {
        render: (w: number) => c.render(w),
        invalidate: () => c.invalidate(),
        handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
      };
    },
    { overlay: true, overlayOptions: { width: "50%", anchor: "center" } }
  );
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("load-skills", {
    description: "Browse and install skills & extensions from ~/pi-skills_vault (opens interactive picker)",
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

      // ── TUI picker ────────────────────────────────────────
      const entries = loadVault();
      if (entries.length === 0) {
        ctx.ui.notify(`Nothing found in vault: ${VAULT}`, "warning");
        return;
      }

      // Phase 1: pick skill or extension
      const selected = await ctx.ui.custom<VaultEntry | null>(
        (tui, theme, _kb, done) => {
          const picker = new VaultPicker(entries, theme);
          picker.onSelect = (e) => done(e);
          picker.onCancel = () => done(null);
          return {
            render: (w) => picker.render(w),
            invalidate: () => picker.invalidate(),
            handleInput: (data) => { picker.handleInput(data); tui.requestRender(); },
          };
        },
        { overlay: true, overlayOptions: { width: "65%", maxHeight: "85%", anchor: "center" } }
      );
      if (!selected) return;

      // Phase 2: link or copy
      const mode = await pickMode(selected.path, ctx);
      if (!mode) return;

      // Phase 3: project or global
      const scope = await pickScope(selected, ctx);
      if (!scope) return;

      // Execute
      const r = spawnSync("bash", [SCRIPT, "install", mode, selected.path, scope], { encoding: "utf8" });
      ctx.ui.notify((r.stdout + r.stderr).trim() || "Done!", r.status === 0 ? "success" : "error");
    },
  });
}
