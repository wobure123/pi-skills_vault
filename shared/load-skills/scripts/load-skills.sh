#!/usr/bin/env bash
# load-skills.sh — Browse and install skills from pi-skills_vault
#
# Usage:
#   load-skills.sh list
#   load-skills.sh preview <category/skill-name>
#   load-skills.sh install --link|--copy <category/skill-name> [--global | <target-dir>]
#   load-skills.sh browse   (interactive, requires fzf)

set -euo pipefail

VAULT="${PI_SKILLS_VAULT:-$HOME/pi-skills_vault}"
GLOBAL_SKILLS_DIR="$HOME/.pi/agent/skills"
PROJECT_SKILLS_DIR="${PWD}/.pi/skills"

# ── Colors ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────────────
get_description() {
    local skill_md="$1/SKILL.md"
    [[ -f "$skill_md" ]] || { echo "(no SKILL.md)"; return; }
    awk '
        /^---/         { fm++; next }
        fm==1 && /^description:/ {
            sub(/^description:[[:space:]]*/, "")
            # YAML block scalar (|, |-,  >) — read next non-empty line
            if ($0 ~ /^[|>]-?[[:space:]]*$/) { block=1; next }
            if (length($0) > 80) $0 = substr($0, 1, 77) "..."
            print; exit
        }
        fm==1 && block {
            # Skip leading whitespace from indented block
            sub(/^[[:space:]]+/, "")
            if ($0 == "") next
            if (length($0) > 80) $0 = substr($0, 1, 77) "..."
            print; exit
        }
        fm>=2          { exit }
    ' "$skill_md"
}

find_skills() {
    find "$VAULT" -name "SKILL.md" -not -path "*/.git/*" \
        | sed "s|/SKILL.md$||" \
        | sed "s|^$VAULT/||" \
        | sort
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_list() {
    if [[ ! -d "$VAULT" ]]; then
        echo -e "${RED}❌ Vault not found: $VAULT${NC}"
        echo "   Set PI_SKILLS_VAULT or create ~/pi-skills_vault"
        exit 1
    fi

    echo -e "${BOLD}📦 pi-skills_vault${NC}  ${DIM}$VAULT${NC}\n"

    local current_cat=""
    while IFS= read -r rel_path; do
        local cat skill_dir desc
        cat="$(echo "$rel_path" | cut -d'/' -f1)"
        skill_dir="$VAULT/$rel_path"
        desc="$(get_description "$skill_dir")"

        if [[ "$cat" != "$current_cat" ]]; then
            [[ -n "$current_cat" ]] && echo ""
            echo -e "${CYAN}[${cat}]${NC}"
            current_cat="$cat"
        fi
        printf "  ${GREEN}%-32s${NC} ${DIM}%s${NC}\n" "$(basename "$rel_path")" "$desc"
        printf "  ${DIM}%-32s${NC}\n" "→ $rel_path"
    done < <(find_skills)

    echo ""
    echo -e "${DIM}Install: load-skills.sh install --link|--copy <category/skill-name>${NC}"
}

cmd_preview() {
    local skill_path="${1:-}"
    [[ -z "$skill_path" ]] && { echo "Usage: preview <category/skill-name>"; exit 1; }

    local skill_dir="$VAULT/$skill_path"
    [[ -d "$skill_dir" ]] || { echo -e "${RED}❌ Not found: $skill_path${NC}"; exit 1; }

    local skill_md="$skill_dir/SKILL.md"
    [[ -f "$skill_md" ]] || { echo -e "${RED}❌ SKILL.md missing in: $skill_path${NC}"; exit 1; }

    echo -e "${BOLD}╔══ $skill_path ══╗${NC}\n"

    echo -e "${YELLOW}📂 Files:${NC}"
    find "$skill_dir" -not -path "*/.git/*" -not -name ".gitkeep" \
        | sed "s|$skill_dir||" | sed 's|^/||' | sort \
        | while read -r f; do [[ -n "$f" ]] && echo "  $f"; done

    echo -e "\n${YELLOW}📄 SKILL.md:${NC}"
    echo "────────────────────────────────────────"
    cat "$skill_md"
    echo "────────────────────────────────────────"
}

cmd_install() {
    local mode="" skill_path="" target_dir="" is_global=false force=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --link|--copy)  mode="$1" ;;
            --global)       is_global=true ;;
            --project)      target_dir="$PROJECT_SKILLS_DIR" ;;
            --force)        force=true ;;
            -*)             echo "Unknown flag: $1"; exit 1 ;;
            *)
                if [[ -z "$skill_path" ]]; then
                    skill_path="$1"
                else
                    target_dir="$1"
                fi
                ;;
        esac
        shift
    done

    [[ -z "$mode" ]]       && { echo "Usage: install --link|--copy <category/skill-name> [--global | <target-dir>]"; exit 1; }
    [[ -z "$skill_path" ]] && { echo "❌ Skill path required (e.g. coding/git-review)"; exit 1; }

    # Resolve target directory
    if $is_global; then
        target_dir="$GLOBAL_SKILLS_DIR"
    elif [[ -z "$target_dir" ]]; then
        target_dir="$PROJECT_SKILLS_DIR"
    fi

    local skill_dir="$VAULT/$skill_path"
    [[ -d "$skill_dir" ]] || { echo -e "${RED}❌ Skill not found in vault: $skill_path${NC}"; exit 1; }

    local skill_name dest
    skill_name="$(basename "$skill_path")"
    mkdir -p "$target_dir"
    dest="$target_dir/$skill_name"

    # Handle existing
    if [[ -e "$dest" || -L "$dest" ]]; then
        if $force; then
            rm -rf "$dest"
            echo -e "${YELLOW}⚠️  Removed existing: $dest${NC}"
        else
            echo -e "${YELLOW}⚠️  Already exists: $dest${NC}"
            echo "   Use --force to overwrite."
            exit 1
        fi
    fi

    local scope_label
    if $is_global; then
        scope_label="global  ${DIM}(~/.pi/agent/skills/)${NC}"
    else
        scope_label="project ${DIM}(${target_dir})${NC}"
    fi

    if [[ "$mode" == "--link" ]]; then
        ln -s "$(realpath "$skill_dir")" "$dest"
        echo -e "${GREEN}✅ Linked${NC}  ${BOLD}$skill_name${NC}"
        echo -e "   scope : $scope_label"
        echo -e "   target: ${DIM}$dest${NC}"
        echo -e "   source: ${DIM}$(realpath "$skill_dir")${NC}"
    else
        cp -R "$skill_dir" "$dest"
        echo -e "${GREEN}✅ Copied${NC}  ${BOLD}$skill_name${NC}"
        echo -e "   scope : $scope_label"
        echo -e "   target: ${DIM}$dest${NC}"
        echo -e "   ${DIM}(edit freely — vault original is untouched)${NC}"
    fi
}

cmd_browse() {
    if ! command -v fzf &>/dev/null; then
        echo -e "${YELLOW}⚠️  fzf not found.${NC} Install: brew install fzf  or  sudo apt install fzf"
        echo ""
        cmd_list
        return
    fi

    # Build tab-separated list: rel_path TAB description
    local list
    list="$(
        while IFS= read -r rel_path; do
            local skill_dir="$VAULT/$rel_path"
            local desc
            desc="$(get_description "$skill_dir")"
            printf "%s\t%s\n" "$rel_path" "$desc"
        done < <(find_skills)
    )"

    if [[ -z "$list" ]]; then
        echo "No skills found in vault: $VAULT"
        exit 1
    fi

    # fzf with SKILL.md preview
    local selected
    selected="$(
        echo "$list" | fzf \
            --ansi \
            --delimiter=$'\t' \
            --with-nth=1,2 \
            --preview="cat \"$VAULT/{1}/SKILL.md\" 2>/dev/null || echo 'No SKILL.md found'" \
            --preview-window=right:58%:wrap \
            --header="↑↓ navigate  Enter select  Esc cancel  |  pi-skills_vault" \
            --prompt="🔍 skill › " \
        | cut -f1 \
        || true
    )"

    [[ -z "$selected" ]] && { echo "Cancelled."; exit 0; }

    echo -e "\n${BOLD}Selected:${NC} $selected"
    echo ""

    # Choose mode
    echo -e "${CYAN}Install mode:${NC}"
    echo "  1) --link   symlink (stays in sync with vault)"
    echo "  2) --copy   copy    (for project customization)"
    read -rp "Choose [1/2, default 1]: " mode_choice
    local install_mode
    case "${mode_choice:-1}" in
        2) install_mode="--copy" ;;
        *) install_mode="--link" ;;
    esac

    # Choose scope
    echo ""
    echo -e "${CYAN}Install scope:${NC}"
    echo "  1) project  current project (.pi/skills/)"
    echo "  2) global   all projects    (~/.pi/agent/skills/)"
    read -rp "Choose [1/2, default 1]: " scope_choice
    local scope_flag
    case "${scope_choice:-1}" in
        2) scope_flag="--global" ;;
        *) scope_flag="--project" ;;
    esac

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
        printf "  ${GREEN}%-8s${NC} %s\n" "list"    "List all skills in vault (grouped by category)"
        printf "  ${GREEN}%-8s${NC} %s\n" "preview" "Preview full SKILL.md  →  preview <category/skill>"
        printf "  ${GREEN}%-8s${NC} %s\n" "install" "Install a skill        →  install --link|--copy <category/skill> [--global | <dir>]"
        printf "  ${GREEN}%-8s${NC} %s\n" "browse"  "Interactive browser (requires fzf)"
        echo ""
        echo "Install flags:"
        printf "  ${CYAN}%-10s${NC} %s\n" "--link"    "Symlink (auto-syncs with vault on update)"
        printf "  ${CYAN}%-10s${NC} %s\n" "--copy"    "Copy (edit freely, won't affect vault)"
        printf "  ${CYAN}%-10s${NC} %s\n" "--global"  "Install to ~/.pi/agent/skills/ (all projects)"
        printf "  ${CYAN}%-10s${NC} %s\n" "--project" "Install to .pi/skills/ in cwd (default)"
        printf "  ${CYAN}%-10s${NC} %s\n" "--force"   "Overwrite if already installed"
        echo ""
        echo "Examples:"
        echo "  $(basename "$0") list"
        echo "  $(basename "$0") preview coding/git-review"
        echo "  $(basename "$0") install --link coding/git-review"
        echo "  $(basename "$0") install --link coding/git-review --global"
        echo "  $(basename "$0") install --copy coding/git-review"
        echo "  $(basename "$0") install --link shared/load-skills --global --force"
        echo "  $(basename "$0") browse"
        echo ""
        echo "Vault: ${VAULT}"
        ;;
    *)
        echo "Unknown command: $CMD  (try: help)"
        exit 1
        ;;
esac
