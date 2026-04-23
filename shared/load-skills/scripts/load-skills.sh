#!/usr/bin/env bash
# load-skills.sh — Browse and install skills & extensions from pi-skills_vault
#
# Usage:
#   load-skills.sh list
#   load-skills.sh preview <category/skill-name>
#   load-skills.sh preview extensions/<name>.ts
#   load-skills.sh install --link|--copy <category/skill-name>  [--global | <dir>]
#   load-skills.sh install --link|--copy extensions/<name>.ts   [--global | <dir>]
#   load-skills.sh browse   (interactive, requires fzf)

set -euo pipefail

VAULT="${PI_SKILLS_VAULT:-$HOME/pi-skills_vault}"
GLOBAL_SKILLS_DIR="$HOME/.pi/agent/skills"
GLOBAL_EXT_DIR="$HOME/.pi/agent/extensions"
PROJECT_SKILLS_DIR="${PWD}/.pi/skills"
PROJECT_EXT_DIR="${PWD}/.pi/extensions"

# ── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; MAGENTA='\033[0;35m'; NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────────────

# Get description from SKILL.md frontmatter (handles block scalar |)
get_skill_description() {
    local skill_md="$1/SKILL.md"
    [[ -f "$skill_md" ]] || { echo "(no SKILL.md)"; return; }
    awk '
        /^---/         { fm++; next }
        fm==1 && /^description:/ {
            sub(/^description:[[:space:]]*/, "")
            if (/^[|>]-?[[:space:]]*$/) { block=1; next }
            if (length($0) > 80) $0 = substr($0, 1, 77) "..."
            print; exit
        }
        fm==1 && block {
            sub(/^[[:space:]]+/, "")
            if ($0 == "") next
            if (length($0) > 80) $0 = substr($0, 1, 77) "..."
            print; exit
        }
        fm>=2 { exit }
    ' "$skill_md"
}

# Get description from extension .ts file (reads first // description: line)
get_ext_description() {
    local ts_file="$1"
    [[ -f "$ts_file" ]] || { echo "(no file)"; return; }
    local desc
    desc="$(grep -m1 '^\s*[/*]*\s*Pi extension:' "$ts_file" 2>/dev/null | sed 's/.*Pi extension:[[:space:]]*//' || true)"
    if [[ -z "$desc" ]]; then
        # Fallback: first non-empty comment line after opening /**
        desc="$(awk '/^\/\*\*/{p=1;next} p && /^\s*\*[^\/]/{sub(/^\s*\*[[:space:]]*/,""); if($0!="") {print;exit}}' "$ts_file" 2>/dev/null || true)"
    fi
    if [[ -z "$desc" ]]; then
        desc="$(head -5 "$ts_file" | grep -m1 '//' | sed 's|.*//[[:space:]]*||' || true)"
    fi
    echo "${desc:-(no description)}" | cut -c1-80
}

# Find all skills (directories with SKILL.md, excluding extensions/)
find_skills() {
    find "$VAULT" -name "SKILL.md" \
        -not -path "*/.git/*" \
        -not -path "*/extensions/*" \
        | sed "s|/SKILL.md$||" \
        | sed "s|^$VAULT/||" \
        | sort
}

# Find all extensions (.ts files in extensions/)
find_extensions() {
    local ext_dir="$VAULT/extensions"
    [[ -d "$ext_dir" ]] || return 0
    find "$ext_dir" -maxdepth 1 -name "*.ts" -not -name "*.d.ts" \
        | sed "s|^$VAULT/||" \
        | sort
}

is_extension() {
    [[ "$1" == extensions/*.ts || "$1" == extensions/* && -f "$VAULT/$1" ]]
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_list() {
    if [[ ! -d "$VAULT" ]]; then
        echo -e "${RED}❌ Vault not found: $VAULT${NC}"
        exit 1
    fi

    echo -e "${BOLD}📦 pi-skills_vault${NC}  ${DIM}$VAULT${NC}\n"

    # Extensions section
    local exts
    exts="$(find_extensions)"
    if [[ -n "$exts" ]]; then
        echo -e "${MAGENTA}[extensions]${NC}"
        while IFS= read -r rel_path; do
            local ts_file="$VAULT/$rel_path"
            local name desc
            name="$(basename "$rel_path" .ts)"
            desc="$(get_ext_description "$ts_file")"
            printf "  ${GREEN}%-32s${NC} ${DIM}%s${NC}\n" "$name" "$desc"
            printf "  ${DIM}%-32s${NC}\n" "→ $rel_path"
        done <<< "$exts"
        echo ""
    fi

    # Skills section grouped by category
    local current_cat=""
    while IFS= read -r rel_path; do
        local cat skill_dir desc
        cat="$(echo "$rel_path" | cut -d'/' -f1)"
        skill_dir="$VAULT/$rel_path"
        desc="$(get_skill_description "$skill_dir")"

        if [[ "$cat" != "$current_cat" ]]; then
            [[ -n "$current_cat" ]] && echo ""
            echo -e "${CYAN}[${cat}]${NC}"
            current_cat="$cat"
        fi
        printf "  ${GREEN}%-32s${NC} ${DIM}%s${NC}\n" "$(basename "$rel_path")" "$desc"
        printf "  ${DIM}%-32s${NC}\n" "→ $rel_path"
    done < <(find_skills)

    echo ""
    echo -e "${DIM}Install: load-skills.sh install --link|--copy <category/skill | extensions/name.ts>${NC}"
}

cmd_preview() {
    local path="${1:-}"
    [[ -z "$path" ]] && { echo "Usage: preview <category/skill-name> or preview extensions/<name>.ts"; exit 1; }

    if is_extension "$path"; then
        local ts_file="$VAULT/$path"
        [[ -f "$ts_file" ]] || { echo -e "${RED}❌ Not found: $path${NC}"; exit 1; }
        echo -e "${BOLD}╔══ extension: $path ══╗${NC}\n"
        head -30 "$ts_file"
        echo -e "\n${DIM}... ($(wc -l < "$ts_file") lines total)${NC}"
    else
        local skill_dir="$VAULT/$path"
        [[ -d "$skill_dir" ]] || { echo -e "${RED}❌ Not found: $path${NC}"; exit 1; }
        local skill_md="$skill_dir/SKILL.md"
        [[ -f "$skill_md" ]] || { echo -e "${RED}❌ SKILL.md missing in: $path${NC}"; exit 1; }

        echo -e "${BOLD}╔══ skill: $path ══╗${NC}\n"
        echo -e "${YELLOW}📂 Files:${NC}"
        find "$skill_dir" -not -path "*/.git/*" -not -name ".gitkeep" \
            | sed "s|$skill_dir||" | sed 's|^/||' | sort \
            | while read -r f; do [[ -n "$f" ]] && echo "  $f"; done

        echo -e "\n${YELLOW}📄 SKILL.md:${NC}"
        echo "────────────────────────────────────────"
        cat "$skill_md"
        echo "────────────────────────────────────────"
    fi
}

cmd_install() {
    local mode="" path="" target_dir="" is_global=false force=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --link|--copy)  mode="$1" ;;
            --global)       is_global=true ;;
            --project)      : ;;  # default, just skip
            --force)        force=true ;;
            -*)             echo "Unknown flag: $1"; exit 1 ;;
            *)
                if [[ -z "$path" ]]; then path="$1"
                else target_dir="$1"; fi ;;
        esac
        shift
    done

    [[ -z "$mode" ]] && { echo "Usage: install --link|--copy <path> [--global | <target-dir>]"; exit 1; }
    [[ -z "$path" ]] && { echo "❌ Path required"; exit 1; }

    # Determine if this is an extension or skill
    if is_extension "$path"; then
        # ── Extension install ──────────────────────────────
        local ts_file="$VAULT/$path"
        [[ -f "$ts_file" ]] || { echo -e "${RED}❌ Extension not found: $path${NC}"; exit 1; }

        local name
        name="$(basename "$path")"

        if [[ -z "$target_dir" ]]; then
            $is_global && target_dir="$GLOBAL_EXT_DIR" || target_dir="$PROJECT_EXT_DIR"
        fi

        mkdir -p "$target_dir"
        local dest="$target_dir/$name"

        if [[ -e "$dest" || -L "$dest" ]]; then
            $force && { rm -f "$dest"; echo -e "${YELLOW}⚠️  Removed existing: $dest${NC}"; } \
                   || { echo -e "${YELLOW}⚠️  Already exists: $dest  (use --force)${NC}"; exit 1; }
        fi

        local scope_label
        $is_global && scope_label="global  ${DIM}(~/.pi/agent/extensions/)${NC}" \
                   || scope_label="project ${DIM}(${target_dir})${NC}"

        if [[ "$mode" == "--link" ]]; then
            ln -s "$(realpath "$ts_file")" "$dest"
            echo -e "${GREEN}✅ Linked extension${NC}  ${BOLD}$name${NC}"
        else
            cp "$ts_file" "$dest"
            echo -e "${GREEN}✅ Copied extension${NC}  ${BOLD}$name${NC}"
        fi
        echo -e "   scope : $scope_label"
        echo -e "   target: ${DIM}$dest${NC}"

    else
        # ── Skill install ──────────────────────────────────
        local skill_dir="$VAULT/$path"
        [[ -d "$skill_dir" ]] || { echo -e "${RED}❌ Skill not found: $path${NC}"; exit 1; }

        local name
        name="$(basename "$path")"

        if [[ -z "$target_dir" ]]; then
            $is_global && target_dir="$GLOBAL_SKILLS_DIR" || target_dir="$PROJECT_SKILLS_DIR"
        fi

        mkdir -p "$target_dir"
        local dest="$target_dir/$name"

        if [[ -e "$dest" || -L "$dest" ]]; then
            $force && { rm -rf "$dest"; echo -e "${YELLOW}⚠️  Removed existing: $dest${NC}"; } \
                   || { echo -e "${YELLOW}⚠️  Already exists: $dest  (use --force)${NC}"; exit 1; }
        fi

        local scope_label
        $is_global && scope_label="global  ${DIM}(~/.pi/agent/skills/)${NC}" \
                   || scope_label="project ${DIM}(${target_dir})${NC}"

        if [[ "$mode" == "--link" ]]; then
            ln -s "$(realpath "$skill_dir")" "$dest"
            echo -e "${GREEN}✅ Linked skill${NC}  ${BOLD}$name${NC}"
        else
            cp -R "$skill_dir" "$dest"
            echo -e "${GREEN}✅ Copied skill${NC}  ${BOLD}$name${NC}"
        fi
        echo -e "   scope : $scope_label"
        echo -e "   target: ${DIM}$dest${NC}"
    fi
}

cmd_browse() {
    if ! command -v fzf &>/dev/null; then
        echo -e "${YELLOW}⚠️  fzf not found.${NC} Install: brew install fzf  or  sudo apt install fzf"
        echo ""
        cmd_list
        return
    fi

    # Build list: rel_path TAB description
    local tmpfile
    tmpfile="$(mktemp)"

    # Extensions first
    while IFS= read -r rel_path; do
        [[ -z "$rel_path" ]] && continue
        local desc
        desc="$(get_ext_description "$VAULT/$rel_path")"
        printf "%s\t%s\n" "$rel_path" "[ext] $desc"
    done < <(find_extensions) >> "$tmpfile"

    # Skills
    while IFS= read -r rel_path; do
        [[ -z "$rel_path" ]] && continue
        local desc
        desc="$(get_skill_description "$VAULT/$rel_path")"
        printf "%s\t%s\n" "$rel_path" "$desc"
    done < <(find_skills) >> "$tmpfile"

    local selected
    selected="$(
        cat "$tmpfile" | fzf \
            --ansi \
            --delimiter=$'\t' \
            --with-nth=1,2 \
            --preview="cat \"$VAULT/{1}/SKILL.md\" 2>/dev/null || head -40 \"$VAULT/{1}\" 2>/dev/null || echo 'Preview unavailable'" \
            --preview-window=right:58%:wrap \
            --header="↑↓ navigate  Enter select  Esc cancel  |  pi-skills_vault" \
            --prompt="🔍 › " \
        | cut -f1 \
        || true
    )"
    rm -f "$tmpfile"

    [[ -z "$selected" ]] && { echo "Cancelled."; exit 0; }
    echo -e "\n${BOLD}Selected:${NC} $selected"
    echo ""

    echo -e "${CYAN}Install mode:${NC}"
    echo "  1) --link   symlink"
    echo "  2) --copy   copy"
    read -rp "Choose [1/2, default 1]: " mc
    local install_mode; case "${mc:-1}" in 2) install_mode="--copy";; *) install_mode="--link";; esac

    echo ""
    echo -e "${CYAN}Scope:${NC}"
    if is_extension "$selected"; then
        echo "  1) project  .pi/extensions/"
        echo "  2) global   ~/.pi/agent/extensions/"
    else
        echo "  1) project  .pi/skills/"
        echo "  2) global   ~/.pi/agent/skills/"
    fi
    read -rp "Choose [1/2, default 1]: " sc
    local scope_flag; case "${sc:-1}" in 2) scope_flag="--global";; *) scope_flag="--project";; esac

    echo ""
    cmd_install "$install_mode" "$selected" "$scope_flag"
}

# ── Main ─────────────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift || true

case "$CMD" in
    list)    cmd_list    "$@" ;;
    preview) cmd_preview "$@" ;;
    install) cmd_install "$@" ;;
    browse)  cmd_browse  "$@" ;;
    help|--help|-h)
        echo -e "${BOLD}load-skills.sh${NC} — pi-skills_vault manager\n"
        echo "Commands:"
        printf "  ${GREEN}%-8s${NC} %s\n" "list"    "List all skills & extensions"
        printf "  ${GREEN}%-8s${NC} %s\n" "preview" "Preview  →  preview <category/skill>  or  extensions/<name>.ts"
        printf "  ${GREEN}%-8s${NC} %s\n" "install" "Install  →  install --link|--copy <path> [--global | <dir>]"
        printf "  ${GREEN}%-8s${NC} %s\n" "browse"  "Interactive browser (requires fzf)"
        echo ""
        echo "Examples:"
        echo "  $(basename "$0") list"
        echo "  $(basename "$0") preview coding/karpathy-guidelines"
        echo "  $(basename "$0") preview extensions/load-skills-ui.ts"
        echo "  $(basename "$0") install --link coding/karpathy-guidelines"
        echo "  $(basename "$0") install --link coding/karpathy-guidelines --global"
        echo "  $(basename "$0") install --link extensions/load-skills-ui.ts --global"
        echo "  $(basename "$0") install --copy coding/boss"
        echo ""
        echo "Vault: ${VAULT}"
        ;;
    *)
        echo "Unknown command: $CMD  (try: help)"
        exit 1
        ;;
esac
