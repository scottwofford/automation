"""Load owner-only local settings without putting Slack tokens in process arguments."""
import os
from pathlib import Path
import runpy

os.umask(0o077)
config = Path.home() / '.config/slack-member-intake'
allowed = {
    'SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_TEAM_ID',
    'INTAKE_ACTIVATED_AT', 'INTAKE_SEND_APPROVED',
    'INTAKE_APPROVED_WELCOME_SHA256', 'INTAKE_STATE_DIR',
}

# Keep credentials separate from the approval and activation timestamp.
# Read plain key=value lines; never execute a settings file as shell code.
for name in ('credentials.env', 'runtime.env'):
    path = config / name
    if path.stat().st_mode & 0o077:
        raise SystemExit('Local bot settings must have owner-only permissions.')
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        if key.strip() in allowed:
            os.environ[key.strip()] = value.strip().strip('"\'')

runpy.run_path(str(Path(__file__).with_name('intake.py')), run_name='__main__')
