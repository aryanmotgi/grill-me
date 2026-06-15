use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RoutingHint {
    pub recommended: String, // "cli" | "web" | "either"
    pub confidence: f64,     // 0.0..1.0
    pub cli_score: f64,
    pub web_score: f64,
    pub reasons: Vec<String>,
}

const MAX_INPUT: usize = 50_000;

// --- Compiled regexes ---

static RE_FENCED_CODE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)```[\s\S]*?```").unwrap());

static RE_FILE_PATH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)[A-Za-z0-9_./-]+\.(rs|tsx|ts|js|py|go|json|yaml|toml|md|sql|sh)\b").unwrap()
});

static RE_CODE_VERBS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(implement|refactor|fix\s+bug|add\s+a\s+function|write\s+a\s+test|run\s+tests)\b").unwrap()
});

static RE_REPO_MENTION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(in\s+src/|in\s+this\s+repo|in\s+this\s+project)\b").unwrap()
});

static RE_SHELL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(\bnpm\b|\bcargo\b|\bpnpm\b|\byarn\b|\bgit\s|\bbash\b|\bzsh\b|\bmake\s)").unwrap()
});

static RE_AT_FILE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(@[A-Za-z0-9_./-]+|\./[A-Za-z0-9_./-]+)").unwrap());

static RE_CLAUDE_CODE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bclaude\s*code\b").unwrap());

// Web signals
static RE_EXPLAIN_START: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*(explain\b|what\s+is\b|why\s+does\b|how\s+do(es)?\b|compare\b|summarize\b)").unwrap()
});

static RE_ADVICE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(should\s+i|what\s+would\s+you|recommend|brainstorm|ideas\s+for)\b").unwrap()
});

static RE_DRIVE_GMAIL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(the\s+article|this\s+pdf|from\s+drive|from\s+gmail)\b").unwrap()
});

static RE_CREATIVE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(write\s+a\s+poem|draft\s+an\s+email|social\s+post|tweet)\b").unwrap()
});

static RE_MODEL_PICKER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(sonnet\s*4\.6|opus|model\s+picker)\b").unwrap());

// Code density characters
static RE_CODE_DENSITY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(;|\{|=>|\bfn\s|\bpub\s)").unwrap());

fn cap_add(score: &mut f64, add: f64, cap: f64, current_contrib: &mut f64) {
    let allowed = (cap - *current_contrib).max(0.0);
    let real = add.min(allowed);
    *score += real;
    *current_contrib += real;
}

fn clamp01(x: f64) -> f64 {
    x.max(0.0).min(1.0)
}

#[tauri::command]
pub fn classify_prompt(text: String) -> RoutingHint {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return RoutingHint {
            recommended: "either".to_string(),
            confidence: 0.0,
            cli_score: 0.0,
            web_score: 0.0,
            reasons: vec!["empty prompt".to_string()],
        };
    }

    let slice: &str = if text.len() > MAX_INPUT {
        // Safe slicing on char boundary
        let mut end = MAX_INPUT;
        while !text.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        &text[..end]
    } else {
        &text
    };

    let mut cli_score = 0.0_f64;
    let mut web_score = 0.0_f64;
    // (label, weight, side: 'c'|'w')
    let mut fired: Vec<(String, f64, char)> = Vec::new();

    // CLI: fenced code block
    if RE_FENCED_CODE.is_match(slice) {
        cli_score += 0.4;
        fired.push(("has code block".to_string(), 0.4, 'c'));
    }

    // CLI: file paths (cap +0.6 at +0.3 each unique)
    let mut paths_seen = std::collections::HashSet::new();
    for m in RE_FILE_PATH.find_iter(slice) {
        paths_seen.insert(m.as_str().to_lowercase());
    }
    let path_hits = paths_seen.len();
    if path_hits > 0 {
        let raw = (path_hits as f64) * 0.3;
        let added = raw.min(0.6);
        cli_score += added;
        fired.push((format!("mentions file path ({})", path_hits), added, 'c'));
    }

    // CLI: imperative coding verbs (cap +0.45 at +0.15 each)
    let verb_hits = RE_CODE_VERBS.find_iter(slice).count();
    if verb_hits > 0 {
        let added = ((verb_hits as f64) * 0.15).min(0.45);
        cli_score += added;
        fired.push((format!("coding verb ({})", verb_hits), added, 'c'));
    }

    // CLI: repo mention
    if RE_REPO_MENTION.is_match(slice) {
        cli_score += 0.2;
        fired.push(("mentions repo/dir".to_string(), 0.2, 'c'));
    }

    // CLI: shell tokens (cap +0.3 at +0.15 each)
    let shell_hits = RE_SHELL.find_iter(slice).count();
    if shell_hits > 0 {
        let added = ((shell_hits as f64) * 0.15).min(0.3);
        cli_score += added;
        fired.push((format!("shell command ({})", shell_hits), added, 'c'));
    }

    // CLI: @file or ./path
    if RE_AT_FILE.is_match(slice) {
        cli_score += 0.3;
        fired.push(("explicit file reference".to_string(), 0.3, 'c'));
    }

    // CLI: Claude Code mention
    if RE_CLAUDE_CODE.is_match(slice) {
        cli_score += 0.5;
        fired.push(("mentions Claude Code".to_string(), 0.5, 'c'));
    }

    // CLI: code density on long paste
    if slice.len() > 200 {
        let dens_hits = RE_CODE_DENSITY.find_iter(slice).count();
        // density threshold: at least 5 hits in long content
        if dens_hits >= 5 {
            cli_score += 0.25;
            fired.push((format!("code-like density ({})", dens_hits), 0.25, 'c'));
        }
    }

    // WEB: explain-style opener
    if RE_EXPLAIN_START.is_match(slice) {
        web_score += 0.3;
        fired.push(("explain-style question".to_string(), 0.3, 'w'));
    }

    // WEB: advice/brainstorm
    if RE_ADVICE.is_match(slice) {
        web_score += 0.25;
        fired.push(("asks for advice/brainstorm".to_string(), 0.25, 'w'));
    }

    // WEB: Drive/Gmail/article
    if RE_DRIVE_GMAIL.is_match(slice) {
        web_score += 0.5;
        fired.push(("mentions web/drive/gmail content".to_string(), 0.5, 'w'));
    }

    // WEB: short pure-prose
    let has_codey_char = slice.contains('`')
        || slice.contains('{')
        || slice.contains(';')
        || RE_FILE_PATH.is_match(slice);
    if trimmed.len() < 200 && !has_codey_char {
        web_score += 0.15;
        fired.push(("short prose, no code".to_string(), 0.15, 'w'));
    }

    // WEB: creative writing
    if RE_CREATIVE.is_match(slice) {
        web_score += 0.4;
        fired.push(("creative writing ask".to_string(), 0.4, 'w'));
    }

    // WEB: model picker mention
    if RE_MODEL_PICKER.is_match(slice) {
        web_score += 0.2;
        fired.push(("mentions model picker".to_string(), 0.2, 'w'));
    }

    // Decision
    let diff = cli_score - web_score;
    let (recommended, confidence) = if diff > 0.25 {
        ("cli".to_string(), clamp01(diff))
    } else if -diff > 0.25 {
        ("web".to_string(), clamp01(-diff))
    } else {
        ("either".to_string(), 0.0)
    };

    // Sort reasons by absolute weight desc, take top 6
    fired.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let reasons: Vec<String> = fired.into_iter().take(6).map(|(s, _, _)| s).collect();

    let reasons = if reasons.is_empty() {
        vec!["no strong signals".to_string()]
    } else {
        reasons
    };

    // suppress unused warning
    let _ = cap_add;

    RoutingHint {
        recommended,
        confidence,
        cli_score,
        web_score,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_refactor_file_path_is_cli() {
        let h = classify_prompt("Refactor src/main.rs to use async".to_string());
        assert_eq!(h.recommended, "cli", "reasons: {:?}", h.reasons);
        assert!(h.cli_score > h.web_score);
    }

    #[test]
    fn test_explain_postgres_is_web() {
        let h = classify_prompt("Explain how Postgres MVCC works".to_string());
        assert_eq!(h.recommended, "web", "reasons: {:?}", h.reasons);
    }

    #[test]
    fn test_variable_name_is_either_or_web() {
        let h = classify_prompt("What should I name this variable?".to_string());
        assert!(
            h.recommended == "either" || h.recommended == "web",
            "got {} reasons: {:?}",
            h.recommended,
            h.reasons
        );
    }

    #[test]
    fn test_empty_string() {
        let h = classify_prompt("".to_string());
        assert_eq!(h.recommended, "either");
        assert_eq!(h.confidence, 0.0);
        assert_eq!(h.reasons, vec!["empty prompt".to_string()]);
    }

    #[test]
    fn test_whitespace_only() {
        let h = classify_prompt("   \n\t  ".to_string());
        assert_eq!(h.recommended, "either");
        assert_eq!(h.confidence, 0.0);
    }

    #[test]
    fn test_code_block_is_cli() {
        let text = "Here is some code:\n```rust\nfn main() { println!(\"hi\"); }\n```\nPlease review.";
        let h = classify_prompt(text.to_string());
        assert_eq!(h.recommended, "cli", "reasons: {:?}", h.reasons);
    }

    #[test]
    fn test_brainstorm_is_web() {
        let h = classify_prompt("Brainstorm 5 product names".to_string());
        assert_eq!(h.recommended, "web", "reasons: {:?}", h.reasons);
    }

    #[test]
    fn test_creative_writing_is_web() {
        let h = classify_prompt("Write a poem about the ocean".to_string());
        assert_eq!(h.recommended, "web", "reasons: {:?}", h.reasons);
    }

    #[test]
    fn test_claude_code_mention_is_cli() {
        let h = classify_prompt("Use Claude Code to fix this".to_string());
        assert_eq!(h.recommended, "cli", "reasons: {:?}", h.reasons);
    }

    #[test]
    fn test_long_input_does_not_panic() {
        let big = "a".repeat(60_000);
        let h = classify_prompt(big);
        // Should classify without panicking
        assert!(h.cli_score >= 0.0);
    }

    #[test]
    fn test_reasons_capped_at_six() {
        let text = "Refactor src/main.rs and src/lib.rs. Implement a function. Write a test. Run tests. Use cargo and npm and git push. ./path/here ```rust\nfn x() {}\n```";
        let h = classify_prompt(text.to_string());
        assert!(h.reasons.len() <= 6);
    }
}
