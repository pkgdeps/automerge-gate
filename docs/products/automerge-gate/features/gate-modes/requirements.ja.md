# ゲートモード

[English](requirements.md)

## このドキュメントについて

ゲートモードは、ゲートがプルリクエストをいつ評価するかと、集約した判定を必須チェックへどう届けるかを決めます。
private mode は、マージの意思があるときだけ評価し、判定を commit status として書き込みます。
public mode は、起動したイベントごとに評価し、判定をゲートのジョブの結果として報告します。
親の Product は [automerge-gate](../../product.ja.md) です。

### スコープ

- `gate-mode` 入力によるゲートモードの選択。
- ゲートが受け付けるイベント。
- private mode で、マージの意思からポーリングするかスキップするかを決めること。
- それぞれのモードで、集約した判定を必須チェックへ報告すること。

### スコープ外

- check run を集めて集約した判定にする方法。[チェックの集約](../check-aggregation/requirements.ja.md)を参照。
- ジョブのログとステップサマリーに表示する内容。[チェック結果のログ](../check-results-log/requirements.ja.md)を参照。
- プルリクエストのマージ。GitHub 純正の auto-merge が行う。
- マージキュー（`merge_group` イベント）。対応していない。

## ユーザーストーリー

### マージの意思があるプルリクエストだけをゲートにかける

内部リポジトリのメンテナとして、誰かがマージするつもりのプルリクエストだけをポーリングしてほしい。ほかのプルリクエストが runner を占有しないようにするためである。

**受け入れ条件:**

Scenario: プルリクエストで auto-merge が有効になった場合、ゲートはポーリングして判定を commit status として書く

- Given: ゲートは private mode で動いており、先頭コミットのほかのチェックはすべて通っている。
- When: メンテナがプルリクエストで auto-merge を有効にする。
- Then: 先頭コミットに、context が設定した `context` で state が `success` の commit status が付き、ゲートのジョブは成功する。

Scenario: マージの意思があるプルリクエストでチェックが失敗している場合、commit status は failure になる

- Given: ゲートは private mode で動いており、先頭コミットのチェックの1つが失敗している。
- When: メンテナがプルリクエストで auto-merge を有効にする。
- Then: 先頭コミットに、設定した context で state が `failure` の commit status が付き、ゲートのジョブは失敗する。

Scenario: マージの意思がない状態でコミットが push された場合、commit status は書かれない

- Given: ゲートは private mode で動いており、auto-merge は無効で、書き込み権限のあるレビュアーの有効な Approve レビューがない。
- When: プルリクエストにコミットが push される。
- Then: ゲートのジョブはポーリングせずに成功し、commit status は書かれず、ステップサマリーと `state` 出力は `skipped` を示す。

Scenario: auto-merge が有効な状態でコミットが push された場合、新しい先頭コミットが評価される

- Given: ゲートは private mode で動いており、プルリクエストでは auto-merge がすでに有効である。
- When: プルリクエストにコミットが push される。
- Then: ゲートは新しい先頭コミットのチェックをポーリングし、そのコミットに commit status を書く。

Scenario: ポーリング中に auto-merge が無効にされた場合も、ゲートは判定を書く

- Given: ゲートは private mode で動いており、auto-merge が有効にされたあとポーリングしている。
- When: チェックが終わる前に、メンテナが auto-merge を無効にする。
- Then: ゲートはポーリングを続け、チェックが終わると commit status を書く。

### Approve レビューをマージの意思として扱う

内部リポジトリのメンテナとして、書き込み権限のある人の Approve レビューでゲートを起動してほしい。auto-merge を有効にしなくても、Approve されたプルリクエストをマージできる状態にするためである。

**受け入れ条件:**

Scenario: 書き込み権限のあるレビュアーが Approve した場合、ゲートはポーリングする

- Given: ゲートは private mode で動いており、ワークフローは `pull_request_review` を受け、auto-merge は無効である。
- When: 書き込み権限のあるレビュアーが Approve レビューを送信する。
- Then: ゲートはチェックをポーリングし、先頭コミットに commit status を書く。

Scenario: 書き込み権限のないレビュアーが Approve した場合、ゲートはスキップする

- Given: ゲートは private mode で動いており、書き込み権限のあるレビュアーの有効な Approve レビューがない。
- When: 読み取り権限のユーザー、またはコラボレーターでないユーザーが Approve レビューを送信する。
- Then: ゲートのジョブはポーリングせずに成功し、commit status は書かれない。

Scenario: 有効な Approve レビューがあるプルリクエストにコミットが push された場合、新しい先頭コミットが評価される

- Given: ゲートは private mode で動いており、auto-merge は無効で、書き込み権限のあるレビュアーの有効な Approve レビューがある。
- When: プルリクエストにコミットが push される。
- Then: ゲートは新しい先頭コミットのチェックをポーリングし、そのコミットに commit status を書く。

Scenario: 唯一の Approve レビューが取り消されたか変更要求に置き換わった場合、push はスキップされる

- Given: ゲートは private mode で動いており、auto-merge は無効で、Approve した唯一のレビュアーの、コメント以外で最新のレビューが取り消し（dismiss）または変更要求である。
- When: プルリクエストにコミットが push される。
- Then: ゲートのジョブはポーリングせずに成功し、commit status は書かれない。

Scenario: Approve ではないレビューが送信された場合、ゲートはスキップする

- Given: ゲートは private mode で動いている。
- When: レビュアーがコメントのレビュー、または変更要求を送信する。
- Then: ゲートのジョブはポーリングせずに成功し、commit status は書かれない。

### 読み取り専用トークンで fork からのプルリクエストをゲートにかける

fork からのプルリクエストを受けるリポジトリのメンテナとして、ゲートが読み取りの権限だけで動いてほしい。fork からのプルリクエストも、ほかと同じようにゲートにかけるためである。

**受け入れ条件:**

Scenario: public mode ですべてのチェックが通った場合、ゲートのジョブは成功する

- Given: ゲートは public mode で動いており、先頭コミットのほかのチェックはすべて通っている。
- When: プルリクエストのイベントがゲートのワークフローを起動する。
- Then: ゲートのジョブは成功し、ゲートは commit status も check run も書かない。

Scenario: public mode でチェックが失敗した場合、ゲートのジョブは失敗する

- Given: ゲートは public mode で動いており、先頭コミットのチェックの1つが失敗している。
- When: プルリクエストのイベントがゲートのワークフローを起動する。
- Then: ゲートのジョブは、集約した状態が failure であるというメッセージとともに失敗する。

Scenario: public mode でマージの意思がない場合も、ゲートはポーリングする

- Given: ゲートは public mode で動いており、auto-merge は無効で、プルリクエストに Approve レビューがない。
- When: プルリクエストにコミットが push される。
- Then: ゲートは先頭コミットのチェックをポーリングし、集約した判定で終わる。

### 誤った設定をはっきり失敗させる

ゲートを設定するメンテナとして、誤った設定は報告してほしい。何もしていないゲートを、通ったゲートと取り違えないためである。

**受け入れ条件:**

Scenario: `gate-mode` が `private` でも `public` でもない場合、許される値を示してジョブが失敗する

- Given: ワークフローが `gate-mode: main` を渡すか、この入力を省略している。
- When: ゲートが起動する。
- Then: ジョブは、`gate-mode` は `private` か `public` でなければならないというメッセージとともに失敗し、ポーリングも書き込みも行われない。

Scenario: トークンでワークフロー実行を一覧できない場合、ポーリングの前にジョブが失敗する

- Given: ジョブの権限に `actions: read` がなく、イベントはポーリングを始めるものである。
- When: ゲートが起動する。
- Then: ジョブは `actions: read` の名前を含むメッセージとともに失敗し、private mode では commit status は書かれない。

Scenario: プルリクエスト以外のイベントでワークフローが起動した場合、ジョブは失敗する

- Given: どちらかのゲートモードで、ゲートのワークフローが `push` で起動している。
- When: ゲートが起動する。
- Then: ジョブは、`pull_request` と `pull_request_review` だけを扱うことと `push` の名前を含むメッセージとともに失敗し、ポーリングも書き込みも行われない。

## KPI

なし。この機能についての計測は記録されていない。

## 機能要件

### モードの選択

**概要:** `gate-mode` 入力が、実行全体について private mode か public mode かを選ぶ。

**入力:** `gate-mode`（必須）: `private` または `public`。

**出力:** 実行は選ばれたモードに従う。空を含むそれ以外の値では、ほかの何よりも前にジョブが失敗する。メッセージは、以前の `gate: main` と `gate: fork` が2つのモードのどちらに当たるかも示す。

### 受け付けるイベント

**概要:** ゲートは `pull_request` と `pull_request_review` のイベントを扱い、プルリクエストとその先頭コミットをイベントから読む。

**入力:** ワークフローを起動したイベント。

**出力:** それ以外のイベントでは、ジョブはそのイベントの名前を含むメッセージとともに失敗し、ポーリングも書き込みも行われない。イベントにプルリクエストが含まれないときは、ジョブが失敗する。

何もしなかったゲートが、通ったゲートに見えてはならない。public mode では、成功して終わったジョブは通った必須チェックになる。プルリクエストのイベント以外でゲートを使う用途はない。

### private mode でのマージの意思の判断

**概要:** private mode では、ゲートは実行の最初に一度だけ、ポーリングするかスキップするかを決める。

**入力:** イベント、その activity type、レビューイベントではレビューの state、イベント時点でプルリクエストの auto-merge が有効かどうか、プルリクエストのレビュー。

**出力:** ポーリングまたはスキップ。理由はジョブのログに出る。

#### 適用する条件

##### ポーリングを始めるイベント

| イベント | 条件 | 結果 |
| --- | --- | --- |
| `pull_request` の `auto_merge_enabled` | 常に | ポーリング |
| `pull_request` の `opened`、`synchronize`、`reopened` | auto-merge が有効 | ポーリング |
| `pull_request` の `opened`、`synchronize`、`reopened` | auto-merge が無効で、書き込み権限のあるレビュアーの有効な Approve レビューがある | ポーリング |
| `pull_request` の `opened`、`synchronize`、`reopened` | どちらでもない | スキップ |
| `pull_request` のそのほかの activity type | 常に | スキップ |
| `pull_request_review` の `submitted` で state が `approved` | 書き込み権限のあるレビュアーの有効な Approve レビューがある | ポーリング |
| `pull_request_review` の `submitted` で state が `approved` | そのようなレビューがない | スキップ |
| それ以外の `pull_request_review` | 常に | スキップ |

##### 有効な Approve レビュー

あるレビュアーの、コメントのレビューを除いた最新のレビューが Approve であるとき、そのレビュアーには有効な Approve レビューがある。
同じレビュアーがあとで取り消し（dismiss）や変更要求をすると、有効ではなくなる。あとからのコメントのレビューでは変わらない。

##### 書き込み権限

リポジトリがそのレビュアーの permission を `admin` か `write` と返すか、role を `admin`、`maintain`、`write` のいずれかと返すとき、そのレビュアーには書き込み権限がある。
コラボレーターでないユーザーには書き込み権限がない。
レビュー自体に示される、レビュアーとリポジトリの関係は使わない。読み取り専用のコラボレーターとメンテナが同じ関係として示されるためである。

##### Approve をマージの意思として扱わない設定

Approve レビューが「マージしてよい」ではなく「問題なさそう」を意味するリポジトリでは、ワークフローのトリガーから `pull_request_review` を外す。
その場合も、すでに有効な Approve レビューがあるプルリクエストへの push は、マージの意思として扱われる。

#### 例外ケースでの振る舞い

##### スキップ

ゲートがスキップするとき、ジョブは成功し、commit status は書かれず、ステップサマリーには state が `skipped` と表示される。`state` 出力は `skipped` になり、件数の出力は `0` になる。
必須チェックは、先頭コミットがすでに持っている状態のままになる。新しい先頭コミットでは、GitHub の「Expected — Waiting for status to be reported」となり、マージはブロックされる。

### private mode での判定の報告

**概要:** ポーリングのあと、ゲートは集約した判定を先頭コミットの commit status として書く。

**入力:** 集約した判定、`context` 入力（既定は `automerge-gate/all-passed`）、`token` 入力。

**出力:** state が `success` または `failure` の commit status。説明文は「N checks passed」または「N checks evaluated, at least one failed」で、N は評価したチェックの数。リンクはゲートのワークフロー実行を開き、そこから再実行できる。`failure` のときはゲートのジョブも失敗する。

#### 適用する条件

##### 権限

ジョブには `statuses: write`、`checks: read`、`pull-requests: read`、`actions: read` が必要である。

##### 書き込む state

書き込むのは `success` と `failure` だけである。ポーリングの前にも途中にも、ゲートは `pending` の status を書かない。

#### 例外ケースでの振る舞い

##### commit status を書き込めない

たとえば fork からのプルリクエストでトークンが読み取り専用であるなど、書き込みが拒否されたときは、ジョブが失敗し、先頭コミットに commit status は存在しない。

##### ポーリングが終わる前にジョブが終わる

ポーリング中にジョブがキャンセルされるか `timeout-minutes` に達したときは、先頭コミットに commit status は書かれない。
もう一度評価するには、メンテナがゲートのジョブを再実行するか、コミットを push するか、auto-merge を無効にしてから有効にし直す。

### public mode での判定の報告

**概要:** ゲートは受け付けたイベントごとにポーリングし、集約した判定でジョブを終える。

**入力:** 集約した判定。

**出力:** `success` ならジョブは成功し、`failure` なら失敗する。GitHub はゲートのジョブに対して、ジョブ名の check run を作る。その check run が必須チェックである。ゲートは API では何も書き込まない。

#### 適用する条件

##### 権限

ジョブには `checks: read`、`pull-requests: read`、`actions: read` が必要である。

##### ジョブ名

ジョブの `name:` は、ruleset の必須チェックと同じでなければならない。`context` 入力は無視される。

##### マージの意思の判断をしない

public mode は auto-merge もレビューも見ない。受け付けたイベントはすべてポーリングする。ワークフローが `pull_request_review` を受けているなら、そのイベントでもポーリングする。

## データ要件

### 必要なデータ

- **プルリクエストのイベント:** イベント名、activity type、プルリクエスト番号、先頭コミット、auto-merge の状態、レビューの state。ワークフローのイベントから読み、保存しない。
- **レビュー:** プルリクエストに対する各レビュアーのレビューと、Approve した各レビュアーのリポジトリでの権限。private mode で、判断に必要なときだけ読み、保存しない。
- **commit status:** private mode で書き込む判定。GitHub が先頭コミットに保持する。

### データ間の関係

commit status は、1つの先頭コミットと1つの context に属する。新しい先頭コミットには、その context の status がまだない。

### 個人情報

private mode では、レビュアーのログイン名と権限の水準を読み、ジョブのログに出す。ほかの場所へは送らない。

## 依存する外部サービス

- **GitHub**
  - **関連するユーザーストーリー:** すべて。
  - **依存する理由:** イベント、レビュー、権限、commit status、必須チェックはすべて GitHub のものである。
  - **契約・利用上の判断:** ゲートはリポジトリ自身の runner で動き、ワークフローのトークンを使う。ポーリングの時間は、そのリポジトリの GitHub Actions の利用量に数えられる。

## セキュリティ上の留意事項

Approve レビューは、レビュアーに書き込み権限があるときだけマージの意思として数える。マージできないユーザーが Approve してゲートを起動することはできない。
public mode は書き込みの権限を必要としない。fork からのプルリクエストで起動したワークフローが、ゲートのトークンでリポジトリを変更することはできない。
トークンは、チェック、ワークフロー実行、レビュー、権限を読むことと、private mode で commit status を書くことにだけ使う。

## 未決事項

なし。
