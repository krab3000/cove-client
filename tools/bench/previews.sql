-- A previews.sh pass: one row per preview (the card's "preview <id> → playing" span, rn-trace), then the pass's
-- totals in previews-total.sql.
select
  substr(name, 9, instr(substr(name, 9), ' ') - 1) video,
  round(dur / 1e6, 1) to_playing_ms,
  exists (select 1 from slice i where i.name = 'preview ' || substr(s.name, 9, instr(substr(s.name, 9), ' ') - 1) || ' none'
          and i.ts between s.ts and s.ts + s.dur + 1e6) none
from slice s where name like 'preview % → playing' and dur > 0
order by ts;
