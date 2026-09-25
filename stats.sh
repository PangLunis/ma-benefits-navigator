#!/bin/bash
# Benefighter free-check completion stats (anonymous). Usage: ./stats.sh [days=30]
DAYS="${1:-30}"
cd "$(dirname "$0")/stats-worker" || exit 1
q() { wrangler d1 execute benefighter-stats --remote --json --command "$1" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); r=d[0]['results']; [print(x) for x in r] if r else print('(no rows)')"; }
SINCE="strftime('%Y-%m-%dT%H:%M:%SZ','now','-$DAYS days')"
echo "== Last $DAYS days =="
q "SELECT COUNT(DISTINCT CASE WHEN ev='start' THEN sid END) AS started, COUNT(DISTINCT CASE WHEN ev='finish' THEN sid END) AS finished, ROUND(100.0*COUNT(DISTINCT CASE WHEN ev='finish' THEN sid END)/NULLIF(COUNT(DISTINCT CASE WHEN ev='start' THEN sid END),0),1) AS pct_finished FROM events WHERE ts >= $SINCE"
echo "== By device =="
q "SELECT dev, COUNT(DISTINCT CASE WHEN ev='start' THEN sid END) AS started, COUNT(DISTINCT CASE WHEN ev='finish' THEN sid END) AS finished FROM events WHERE ts >= $SINCE GROUP BY dev"
echo "== Where people who didn't finish stopped (furthest question) =="
q "SELECT qn, qid, COUNT(*) AS people FROM events WHERE ev='leave' AND ts >= $SINCE AND sid NOT IN (SELECT sid FROM events WHERE ev='finish') GROUP BY qn, qid ORDER BY people DESC, qn LIMIT 15"
echo "== Per day =="
q "SELECT substr(ts,1,10) AS day, COUNT(DISTINCT CASE WHEN ev='start' THEN sid END) AS started, COUNT(DISTINCT CASE WHEN ev='finish' THEN sid END) AS finished FROM events WHERE ts >= $SINCE GROUP BY day ORDER BY day DESC LIMIT 14"
