-- A previews.sh pass's totals: CPU time of the app and the media codec processes over the pass, and the app's frames
-- (its main window, FrameTimeline) and how many missed their deadline because of the app (FrameTimeline's
-- "App Deadline Missed"; buffer and SurfaceFlinger stuffing are queueing, not the app being late).
with
span as (select min(ts) t0, max(ts + dur) t1 from slice where name like 'preview % → playing'),
cove as (select upid from process where name = 'com.cove.client'),
codec as (select upid from process where name like '%media.c2%' or name like '%media.codec%' or name like '%mediaserver%' or name like '%media.swcodec%'),
cpu as (
  select
    sum(case when t.upid in (select upid from cove) then s.dur else 0 end) app,
    sum(case when t.upid in (select upid from codec) then s.dur else 0 end) codec
  from sched_slice s join thread t using (utid)
  where s.ts between (select t0 from span) and (select t1 from span)
),
app_frames as (
  select * from actual_frame_timeline_slice where upid in (select upid from cove)
    and ts between (select t0 from span) and (select t1 from span)
)
select
  round(((select t1 from span) - (select t0 from span)) / 1e9, 1) seconds,
  round((select app from cpu) * 100.0 / ((select t1 from span) - (select t0 from span))) app_cpu_pct,
  round((select codec from cpu) * 100.0 / ((select t1 from span) - (select t0 from span))) codec_cpu_pct,
  (select count(*) from app_frames) app_frames,
  (select count(*) from app_frames where jank_type like '%App Deadline Missed%') app_late_frames;
