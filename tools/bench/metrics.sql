-- One benchmark run's numbers from its trace (run.sh): one row. Times are ms from the tap (when JavaScript handled
-- it: Cove's "tap <id>" instant, rn-trace). "On screen" is the first buffer the player's SurfaceView hands to
-- SurfaceFlinger (setBuffer … hasBuffer=true), the same for both engines; the player's SurfaceView is the one whose
-- first buffer comes after the tap (a preview's existed before).
with
tap as (select min(ts) ts from slice where name like 'tap %'),
buffers as (
  select s.ts, replace(replace(s.name, 'setBuffer ', ''), ' - hasBuffer=true', '') layer
  from slice s where s.name like 'setBuffer SurfaceView%hasBuffer=true'
),
player_layer as (
  select layer from buffers group by layer having min(ts) > (select ts from tap) order by min(ts) limit 1
),
frames as (select ts from buffers where layer = (select layer from player_layer)),
first_frame as (select min(ts) ts from frames),
play_span as (select ts, dur from slice where name like 'play % → first frame' order by ts limit 1),
seek_span as (select ts, dur from slice where name like 'resume seek % → done' order by ts limit 1),
after_seek as (
  select min(ts) ts from frames where ts >= (select ts + dur from seek_span)
),
-- Steady playback: the first frame after the last stall (> 250 ms without a new frame) in the 8 s after the tap.
-- A player may report a seek done before its picture moves on (libVLC: as soon as its clock jumps), so this, not
-- seek done, is where resuming really played on.
stalls as (
  select ts, ts - lag(ts) over (order by ts) gap from frames where ts <= (select ts from tap) + 8e9
),
settled as (
  select coalesce((select max(ts) from stalls where gap > 250e6), (select ts from first_frame)) ts
),
-- Smoothness over the 5 s after that.
window5 as (select ts from frames where ts between (select ts from settled) and (select ts from settled) + 5e9),
gaps as (
  select ts - lag(ts) over (order by ts) gap from window5
),
cove as (select upid from process where name = 'com.cove.client'),
codec as (select upid from process where name like '%media.c2%' or name like '%media.codec%' or name like '%mediaserver%' or name like '%media.swcodec%'),
cpu as (
  select
    sum(case when t.upid in (select upid from cove) then s.dur else 0 end) app,
    sum(case when t.upid in (select upid from codec) then s.dur else 0 end) codec
  from sched_slice s join thread t using (utid)
  where s.ts between (select ts from tap) and (select ts from tap) + 5e9
),
lib as (select name, min(ts) ts, sum(dur) dur, count(*) n from slice where category = 'libav' group by name),
vlc as (select name, ts, dur from slice where name like 'vlc open → %')
select
  case when exists (select 1 from vlc) then 'vlc' else 'libav' end engine,
  -- More than one: something else pressed too (the run is left out of the report).
  (select count(*) from slice where name like 'tap %') taps,
  round(((select ts from first_frame) - (select ts from tap)) / 1e6, 1) on_screen_ms,
  round((select dur from play_span) / 1e6, 1) js_first_progress_ms,
  round(((select ts + dur from seek_span) - (select ts from tap)) / 1e6, 1) seek_done_ms,
  round(((select ts from after_seek) - (select ts from tap)) / 1e6, 1) on_screen_after_seek_ms,
  round(((select ts from settled) - (select ts from tap)) / 1e6, 1) steady_ms,
  (select count(*) from window5) frames_5s,
  round((select max(gap) from gaps) / 1e6, 1) max_frame_gap_ms,
  round((select app from cpu) / 1e6) app_cpu_ms_5s,
  round((select codec from cpu) / 1e6) codec_cpu_ms_5s,
  round((select dur from lib where name = 'startup') / 1e6, 1) libav_startup_ms,
  round((select dur from lib where name = 'http fetch') / 1e6, 1) libav_http_ms,
  (select n from lib where name = 'http fetch') libav_http_n,
  (select n from lib where name = 'disk read') libav_disk_n,
  round((select dur from lib where name = 'avcodec_open2') / 1e6, 1) libav_codec_open_ms,
  round((select dur from vlc where name like '%→ playing%') / 1e6, 1) vlc_open_playing_ms,
  round((select dur from vlc where name like '%→ vout%') / 1e6, 1) vlc_open_vout_ms,
  round((select dur from vlc where name like '%→ first time%') / 1e6, 1) vlc_open_first_time_ms;
