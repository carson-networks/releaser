# Releaser

A GitHub Action that creates a version tag and GitHub Release based on PR labels.
It inspects every PR merged since the last semver tag, picks the highest bump label,
and publishes a release with a generated changelog.

## Usage

```yaml
- uses: carson-networks/releaser@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Example workflow

```yaml
name: Release

on:
  workflow_dispatch:
  push:
    branches:
      - master

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: carson-networks/releaser@v1
        id: releaser
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          default_bump: patch
          base_branch: master
          draft_release: "false"

      - name: Print outputs
        run: |
          echo "version:     ${{ steps.releaser.outputs.version }}"
          echo "tag:         ${{ steps.releaser.outputs.tag_name }}"
          echo "release_id:  ${{ steps.releaser.outputs.release_id }}"
          echo "release_url: ${{ steps.releaser.outputs.release_url }}"
```

## Inputs

| Input           | Required | Default      | Description                                                                                                                                                              |
| --------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `github_token`  | Yes      | —            | GitHub token with `contents: write` permission. Use `secrets.GITHUB_TOKEN` or a PAT.                                                                                     |
| `default_bump`  | No       | `patch`      | Bump to apply when no merged PR carries a release label. One of `patch`, `minor`, `major`, `none`. Use `none` to skip releasing entirely when there are no labelled PRs. |
| `ref`           | No       | `github.sha` | Commit SHA to tag. Defaults to the SHA that triggered the workflow.                                                                                                      |
| `base_branch`   | No       | `master`     | Branch whose merged PRs are scanned for release labels and included in the changelog.                                                                                    |
| `draft_release` | No       | `false`      | Set to `"true"` to create a draft release instead of publishing immediately.                                                                                             |

## Outputs

| Output        | Description                                      |
| ------------- | ------------------------------------------------ |
| `version`     | New version without a leading `v`, e.g. `1.2.3`. |
| `tag_name`    | Git tag created, e.g. `v1.2.3`.                  |
| `release_id`  | Numeric GitHub Release ID.                       |
| `release_url` | HTML URL of the created GitHub Release.          |

## Label semantics

Add one of these labels to a PR before merging it:

| Label           | Effect                                            |
| --------------- | ------------------------------------------------- |
| `release:major` | Bumps the major version (e.g. `1.2.3` → `2.0.0`). |
| `release:minor` | Bumps the minor version (e.g. `1.2.3` → `1.3.0`). |
| `release:patch` | Bumps the patch version (e.g. `1.2.3` → `1.2.4`). |

When multiple PRs carry different labels, the **highest** bump wins — one
`release:minor` plus several `release:patch` PRs results in a minor bump.

If no merged PR since the last tag has a release label, the `default_bump` input
is used. Setting it to `none` causes the action to exit without creating a release.

## First release

When no semver tag exists yet, the first version is derived from `default_bump`:

| `default_bump` | First version          |
| -------------- | ---------------------- |
| `patch`        | `v0.0.1`               |
| `minor`        | `v0.1.0`               |
| `major`        | `v1.0.0`               |
| `none`         | _(no release created)_ |

## Permissions

The workflow job needs `contents: write` to create tags and releases:

```yaml
permissions:
  contents: write
```

## Changelog format

The release body lists every merged PR since the last tag, oldest first:

```markdown
## What's Changed

- Fix login redirect ([#42](https://github.com/org/repo/pull/42)) by @alice
- Add dark mode ([#43](https://github.com/org/repo/pull/43)) by @bob
```
