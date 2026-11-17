# 学び: スタックの auto-merge を有効にしても `auto_merge_enabled` は届かない

日付: 2026-11-17
ステータス: `poll-on-stacked-pull-requests` 入力の前提になっている観察の記録

## 結論

GitHub のスタック（stacked pull requests）に入っているプルリクエストでは、UI でスタックの auto-merge を有効にしても、`pull_request` の `auto_merge_enabled` イベントが webhook にも GitHub Actions にも届かない。
private mode は auto-merge の有効化をマージの意思として待つので、スタック内のプルリクエストでは必須チェックが「Expected」のまま残り、スタックをマージできない。

届かないのがロールアウト途中だからなのか、仕様なのかを示す記述は見つかっていない。
調査の時点で、GitHub Docs はスタックのプルリクエストでは auto-merge に対応していないとしており、スタックの auto-merge は順次提供中の機能だった（出典は下の #46 のコメント）。

そのため `poll-on-stacked-pull-requests` は、この観察にもとづく回避策である。GitHub が `auto_merge_enabled` を届けるようになったら、この記録の観察をやり直し、入力が要るかを見直す。

## 観察した事実

pkgdeps/automerge-gate-example に2つのプルリクエストのスタックを作り、`pull_request` のすべての activity type を受けるワークフローと、すべてのイベントを受ける webhook で記録した。

| 操作 | プルリクエストのタイムライン | webhook | GitHub Actions |
| --- | --- | --- | --- |
| プルリクエストを作る | — | `opened`。`pull_request.stack` は `null` | 起動する |
| スタックに入れる（API でも UI でも） | `added_to_stack` | `stacked` がスタック内のすべてのプルリクエストに届く。順序は決まっていない | 起動する |
| REST でプルリクエストごとに auto-merge を有効にする | — | 届かない（HTTP 422 `Auto-merge is not supported for stacked pull requests.`） | 起動しない |
| UI でスタックの auto-merge を有効にする | `auto_merge_enabled` がすべてのプルリクエストに記録される | 届かない | 起動しない |
| 対照: ラベルを付ける | `labeled` | `labeled` が届く | 起動する |

- `stacked` 以降のイベントでは、`pull_request.stack` に `number`（スタックの番号）、`position`（下から数えた位置）、`size`（スタック内のプルリクエストの数）、`base` が入る。
- スタックの auto-merge を有効にしたあと、`pull_request.auto_merge` に値が入るのはスタックの一番上のプルリクエストだけで、下のプルリクエストは `null` のままだった。

## `poll-on-stacked-pull-requests` を有効にしたときの確認

同じリポジトリで、入力を `true` にした private mode のゲートを動かした。

| イベント | 結果 |
| --- | --- |
| `opened`（まだスタックに入っておらず `stack` は `null`） | スキップ。commit status なし |
| `stacked`（スタック内の両方のプルリクエスト） | ポーリング。両方の先頭コミットに `success` の commit status |
| `synchronize`（スタックの上のプルリクエスト） | ポーリング。新しい先頭コミットに `success` の commit status |

API で作ったスタックでも、UI で作ったスタックでも結果は同じだった。
そのあと、どちらのプルリクエストも `mergeable_state` は `clean` になった。

## チェックが終わる前にスタックの auto-merge を有効にしたときの確認

ゲートが `success` を書いたあとに auto-merge を有効にしようとすると、すぐマージできる状態なので auto-merge ではなく通常のマージになる。
そこで、10分待つだけのチェックを足したスタック（2つのプルリクエスト）を作り、チェックの実行中に UI でスタックの auto-merge を有効にした。

| 時刻（UTC） | 起きたこと |
| --- | --- |
| 12:51:29 | スタックを作る。`stacked` で両方のプルリクエストのゲートが起動し、ポーリングを始める |
| 12:52:22 | UI でスタックの auto-merge を有効にする。タイムラインに `auto_merge_enabled` が記録されるが、ワークフローは起動しない |
| 13:01:30 | 10分待つチェックが終わる |
| 13:01:39〜44 | ポーリング中だったゲートが、両方の先頭コミットに `success` の commit status を書く |
| 13:02:34〜36 | 下、上の順に、auto-merge でマージされる |

`stacked` で始めたポーリングが判定を書けば、スタックの auto-merge はそれを待ってマージする。
auto-merge を有効にしたことでゲートが起動する必要はない。

## 参照

- 調査の報告: [#46 のコメント](https://github.com/pkgdeps/automerge-gate/issues/46#issuecomment-6944761299)
- [Merging stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests)（GitHub Docs）
