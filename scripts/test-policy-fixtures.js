const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function write(project, relative, content) {
  const filename = path.join(project, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content, 'utf8');
}

function git(project, args) {
  return execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
}

function writeBaseline(project) {
  const baselineLog = '.review-evidence/baseline-full.log';
  write(project, baselineLog, 'COMMAND=node --test\nEXIT_CODE=0\n');
  write(project, '.review-evidence/baseline.md', [
    '# Review Baseline',
    '',
    '## MVP Scope',
    '- Included: synthetic test fixture',
    '- Explicitly excluded: none',
    '',
    '## Test Scope / Regression Policy',
    '- Tiering mode: default',
    '- Full-suite duration: under one second',
    '- Baseline full result: pass',
    '- Baseline full log: ' + baselineLog,
    '- Expected test count: 1 / 1 / 0 / 0',
    '- Full suite composition: unit',
    '- Feature matrix: default',
    '- Focused test command: node --test',
    '- Impacted test command: node --test',
    '- Full test command: node --test',
    '- Adjacent test command: node --test tests/review/verifications',
    '- High-risk paths: none',
    '- Verification default: impacted; P0/P1/high-risk rerun full',
    '- Notes: synthetic fixture',
    '',
  ].join('\n'));
}

function fullSuite(project, evidenceDir, treeHash) {
  const log = evidenceDir + '/output-full-suite.log';
  write(project, log, 'COMMAND=node --test\nEXIT_CODE=0\n');
  return {
    status: 'pass',
    command: 'node --test',
    exit_status: 0,
    tree_hash_before: treeHash,
    tree_hash_after: treeHash,
    run_location: 'main-workspace',
    workspace_clean_before: true,
    workspace_clean_after: true,
    test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    expected_test_count_delta: 0,
    expected_skipped_count_delta: 0,
    log,
  };
}

function appendReport(project, filename, heading, object) {
  let previous = fs.existsSync(path.join(project, filename))
    ? fs.readFileSync(path.join(project, filename), 'utf8').replace(/\s*$/, '') + '\n\n'
    : '';
  const marker = '## ' + heading + '\n';
  const headingIndex = previous.indexOf(marker);
  if (headingIndex >= 0) {
    const remainder = previous.slice(headingIndex + marker.length);
    const nextHeading = remainder.indexOf('\n## ');
    previous = previous.slice(0, headingIndex) + (nextHeading >= 0 ? remainder.slice(nextHeading + 1) : '');
    previous = previous.trimEnd() + '\n\n';
  }
  const fence = String.fromCharCode(96).repeat(3);
  write(project, filename, previous + '## ' + heading + '\n' + fence + 'json\n' + JSON.stringify(object, null, 2) + '\n' + fence + '\n');
}

function writeGreenEvidence(project, evidenceDir, treeHash) {
  appendReport(project, evidenceDir + '/implementation-result.md', 'Reviewctl GREEN Evidence', {
    full_suite: fullSuite(project, evidenceDir, treeHash),
  });
}

function writeVerificationEvidence(project, evidenceDir, finding, risk = 'normal') {
  const head = git(project, ['rev-parse', 'HEAD']);
  const headTree = git(project, ['rev-parse', 'HEAD^{tree}']);
  const fullRequired = ['P0', 'P1'].includes(finding.severity) || risk === 'high' || finding.implementation_status === 'already_fixed';
  const scope = fullRequired ? 'full' : 'impacted';
  const log = evidenceDir + (fullRequired ? '/verification-full.log' : '/verification-impacted.log');
  write(project, log, 'COMMAND=' + (fullRequired ? 'node --test' : 'node --test') + '\nEXIT_CODE=0\n');
  const regression = {
    scope,
    status: 'pass',
    command: 'node --test',
    exit_status: 0,
    log,
    tree_hash_before: headTree,
    tree_hash_after: headTree,
    tested_commit: head,
    changed_paths: ['src/fix.js'],
    impacted_targets: ['tests/fix.test.js'],
    impact_basis: 'synthetic fixture dependency graph',
    dependency_closure: 'transitive_reverse',
    test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
  };
  const evidence = {
    schema_version: 1,
    verdict: 'pass',
    regression,
    risk_assessment: risk,
    implementation_full_suite_status: 'pass',
  };
  if (risk === 'high') evidence.risk_reason = 'synthetic high-risk fixture';
  if (fullRequired) {
    const suite = fullSuite(project, evidenceDir, headTree);
    suite.log = log;
    write(project, log, 'COMMAND=node --test\nEXIT_CODE=0\n');
    evidence.full_test_suite = Object.assign(suite, { tested_commit: head });
  }
  appendReport(project, evidenceDir + '/verification-result.md', 'Reviewctl Verification Evidence', evidence);
}

module.exports = { writeBaseline, writeGreenEvidence, writeVerificationEvidence, git };
