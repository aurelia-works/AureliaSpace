//! The pull request for a pane's branch, read with `gh pr view`, so a thread can show its
//! PR and wake its agent when checks fail, a review lands or the branch conflicts.

use crate::config::expand_path;
use crate::which;
use serde::Serialize;
use serde_json::Value;
use std::process::Command;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    /// "OPEN" | "MERGED" | "CLOSED"
    pub state: String,
    pub draft: bool,
    /// "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" (no review rule)
    pub review: String,
    pub conflicts: bool,
    /// "none" | "pending" | "pass" | "fail"
    pub checks: String,
    /// Names of the checks that failed.
    pub failing: Vec<String>,
    /// Reviews plus conversation comments; a rise means new feedback.
    pub feedback: u64,
}

const FAILED: [&str; 6] = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];

/// Turns `gh pr view --json …` output into a PrInfo.
fn summarise(v: &Value) -> Option<PrInfo> {
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let mut failing = Vec::new();
    let mut pending = false;
    let rollup = v["statusCheckRollup"].as_array().cloned().unwrap_or_default();
    for c in &rollup {
        // CheckRun: status + conclusion; StatusContext: state.
        let name = c["name"].as_str().or(c["context"].as_str()).unwrap_or("check").to_string();
        let conclusion = c["conclusion"].as_str().or(c["state"].as_str()).unwrap_or_default();
        let status = c["status"].as_str().unwrap_or("COMPLETED");
        if FAILED.contains(&conclusion) {
            failing.push(name);
        } else if status != "COMPLETED" || conclusion == "PENDING" || conclusion == "EXPECTED" || conclusion.is_empty() {
            pending = true;
        }
    }
    let checks = if rollup.is_empty() {
        "none"
    } else if !failing.is_empty() {
        "fail"
    } else if pending {
        "pending"
    } else {
        "pass"
    };
    let count = |k: &str| v[k].as_array().map_or(0, |a| a.len() as u64);
    Some(PrInfo {
        number: v["number"].as_u64()?,
        url: s("url"),
        title: s("title"),
        state: s("state"),
        draft: v["isDraft"].as_bool().unwrap_or(false),
        review: s("reviewDecision"),
        conflicts: v["mergeable"].as_str() == Some("CONFLICTING"),
        checks: checks.into(),
        failing,
        feedback: count("reviews") + count("comments"),
    })
}

/// The PR for the branch checked out in `cwd`, or None when it has none (or gh is missing
/// or signed out: a thread just shows no PR then).
#[tauri::command]
pub async fn pr_status(cwd: String) -> Result<Option<PrInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(gh) = which::locate("gh") else { return Ok(None) };
        let out = Command::new(gh)
            .current_dir(expand_path(&cwd))
            .args(["pr", "view", "--json", "number,url,title,state,isDraft,reviewDecision,mergeable,statusCheckRollup,reviews,comments"])
            .env("GH_PROMPT_DISABLED", "1")
            .output()
            .map_err(|e| format!("gh: {e}"))?;
        if !out.status.success() {
            return Ok(None);
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        Ok(summarise(&v))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn failing_check_wins_over_pending() {
        let v = json!({
            "number": 12, "url": "u", "title": "t", "state": "OPEN", "isDraft": false,
            "reviewDecision": "CHANGES_REQUESTED", "mergeable": "CONFLICTING",
            "statusCheckRollup": [
                {"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"},
                {"__typename": "CheckRun", "name": "lint", "status": "IN_PROGRESS", "conclusion": ""},
                {"__typename": "StatusContext", "context": "ci/other", "state": "SUCCESS"}
            ],
            "reviews": [{}, {}], "comments": [{}]
        });
        let p = summarise(&v).unwrap();
        assert_eq!(p.checks, "fail");
        assert_eq!(p.failing, vec!["test".to_string()]);
        assert!(p.conflicts);
        assert_eq!(p.feedback, 3);
        assert_eq!(p.review, "CHANGES_REQUESTED");
    }

    #[test]
    fn checks_pending_then_pass_then_none() {
        let pending = json!({"number": 1, "statusCheckRollup": [{"context": "ci", "state": "PENDING"}]});
        assert_eq!(summarise(&pending).unwrap().checks, "pending");
        let pass = json!({"number": 1, "statusCheckRollup": [{"name": "a", "status": "COMPLETED", "conclusion": "SUCCESS"}, {"name": "b", "status": "COMPLETED", "conclusion": "SKIPPED"}]});
        assert_eq!(summarise(&pass).unwrap().checks, "pass");
        let none = json!({"number": 1, "statusCheckRollup": []});
        let p = summarise(&none).unwrap();
        assert_eq!(p.checks, "none");
        assert!(!p.conflicts);
        assert_eq!(p.feedback, 0);
    }

    #[test]
    fn no_number_is_no_pr() {
        assert_eq!(summarise(&json!({"state": "OPEN"})), None);
    }
}
