# dsh-bang-shell

Run `!command` in a DeepSeek Harness session and hand the model **only the output**.
The command line itself never enters the model context, so it can carry secrets
or anything you would not paste into a chat.

## How it works

A tiny host-side plugin. During the agent pre-step it recognises a user message
that starts with `!`, runs the rest as a shell command in the session working
directory, and replaces that message with the command output. The model sees the
output and answers; the original line is never part of the request.

Because the rewrite happens on the host, the same gesture works in the Web UI
and in mobile clients such as Whaleness: no client code, no model-facing tool.

## Install

```sh
git clone https://github.com/toyoshin5/dsh-bang-shell.git
dsh plugin --profile web add "link:$PWD/dsh-bang-shell"
# restart the web surface: dsh web
```

Or from GitHub directly:

```sh
dsh plugin --profile web add "github:toyoshin5/dsh-bang-shell"
```

## Use

```text
!pwd
!git status
!security find-generic-password -w -s example.com -a me | pbcopy
```

The output comes back to the model. With `includeCommand: false` (default) the
model does not learn which command produced it.

## Configuration

Override the `bang-shell` row in the profile's `cordis.patch.yml`:

```yaml
- id: bang-shell
  config:
    timeoutMs: 120000
    maxOutputChars: 20000
    loginShell: true
    prefix: '[local shell output]'
    includeCommand: false
    shell: /bin/zsh
```

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | 120000 | kill the command after this long |
| `maxOutputChars` | 20000 | keep the tail of the output |
| `loginShell` | true | run as `$SHELL -lc` |
| `prefix` | `[local shell output]` | first line the model sees |
| `includeCommand` | false | also reveal the command line to the model |
| `shell` | `$SHELL` | shell executable |

## Security notes

- Commands run with the host user's full permissions, outside the agent sandbox.
- There is no TTY: `sudo`, `vim` and password prompts are not supported.
- The transcript on disk still contains the original `!command` line; the plugin
  only keeps it out of the model request. Do not put secrets in a command line
  that will be persisted — pipe them in, for example from a keychain lookup.
- Output is sent to the model verbatim: filter it (`grep -v`) when it may contain
  secrets.

## Test

```sh
node --test test/
```

## License

MIT