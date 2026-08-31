//! Monitor selection and position math for the overlay show path (T1 of
//! overlay-focus-and-inline-actions).
//!
//! The layout used throughout mirrors the user's real desk: a 2x Retina
//! built-in (primary) next to two 1x externals. tao reports monitors in
//! "physical" pixels made by scaling each monitor's point rect by its own
//! factor, and the cursor scaled by the primary's factor — so the 2x case is
//! where a logical/physical mix-up stops being invisible.

use stash_lib::placement::{
    cursor_points, monitor_rect_points, overlay_origin, pick_monitor, Rect, OVERLAY_TOP_FRACTION,
};

/// The user's layout in points (CGDisplayBounds): built-in 1512x982 at the
/// origin, a 2560x1440 external to its right, another below.
fn point_rects() -> Vec<Rect> {
    vec![
        Rect { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 },
        Rect { x: 1512.0, y: 0.0, width: 2560.0, height: 1440.0 },
        Rect { x: 0.0, y: 982.0, width: 2560.0, height: 1440.0 },
    ]
}

/// The same layout as tao hands it over: physical position/size per monitor
/// (each scaled by its own factor), converted back to points.
fn rects_from_tao_report() -> Vec<Rect> {
    vec![
        // Built-in, scale 2.0: 1512x982 pt reported as 3024x1964 px.
        monitor_rect_points((0.0, 0.0), (3024.0, 1964.0), 2.0),
        // Externals, scale 1.0: physical == points.
        monitor_rect_points((1512.0, 0.0), (2560.0, 1440.0), 1.0),
        monitor_rect_points((0.0, 982.0), (2560.0, 1440.0), 1.0),
    ]
}

#[test]
fn tao_physical_report_converts_back_to_the_point_layout() {
    assert_eq!(rects_from_tao_report(), point_rects());
}

#[test]
fn cursor_on_each_display_picks_that_display() {
    let rects = point_rects();
    assert_eq!(pick_monitor((100.0, 100.0), &rects), Some(0));
    assert_eq!(pick_monitor((2000.0, 700.0), &rects), Some(1));
    assert_eq!(pick_monitor((500.0, 1500.0), &rects), Some(2));
}

/// The 2x trap, end to end: the cursor sits on the built-in at (1000, 500) pt.
/// tao reports it scaled by the primary's 2x factor as (2000, 1000) px — a
/// point that, tested naively against the *physical* rects, is inside BOTH the
/// built-in (3024x1964 px) and the right-hand external (x 1512..4072 px): the
/// physical rects overlap, so naive physical containment is ambiguous and can
/// return the wrong display. In points the rects tile and the answer is unique.
#[test]
fn retina_cursor_resolves_unambiguously_in_points() {
    let rects = rects_from_tao_report();
    let cursor = cursor_points((2000.0, 1000.0), 2.0);
    assert_eq!(cursor, (1000.0, 500.0));
    assert_eq!(pick_monitor(cursor, &rects), Some(0));

    // The overlap that makes the naive version wrong, pinned down so a change
    // to the conversion cannot silently make this test vacuous:
    let physical_builtin = Rect { x: 0.0, y: 0.0, width: 3024.0, height: 1964.0 };
    let physical_external = Rect { x: 1512.0, y: 0.0, width: 2560.0, height: 1440.0 };
    assert!(physical_builtin.contains(2000.0, 1000.0));
    assert!(physical_external.contains(2000.0, 1000.0));
}

/// A cursor on the 1x external, reported through the primary's 2x factor.
#[test]
fn cursor_on_the_external_still_picks_the_external() {
    let rects = rects_from_tao_report();
    // (1600, 200) pt -> tao reports (3200, 400) px.
    let cursor = cursor_points((3200.0, 400.0), 2.0);
    assert_eq!(cursor, (1600.0, 200.0));
    assert_eq!(pick_monitor(cursor, &rects), Some(1));
}

#[test]
fn shared_edge_belongs_to_exactly_one_display() {
    let rects = point_rects();
    // x = 1512 is the external's left edge, not the built-in's right edge.
    assert_eq!(pick_monitor((1512.0, 100.0), &rects), Some(1));
}

#[test]
fn cursor_fractionally_outside_every_rect_falls_back_to_the_nearest() {
    let rects = point_rects();
    // Just above the external's top edge — macOS can report this at corners.
    assert_eq!(pick_monitor((2000.0, -0.5), &rects), Some(1));
    assert_eq!(pick_monitor((-3.0, 100.0), &rects), Some(0));
}

#[test]
fn no_monitors_picks_nothing() {
    assert_eq!(pick_monitor((0.0, 0.0), &[]), None);
}

#[test]
fn top_fraction_is_inside_the_agreed_band() {
    assert!((0.25..=0.30).contains(&OVERLAY_TOP_FRACTION));
}

/// Position rule on the 2x built-in: 640pt panel centered, top edge at 28%.
#[test]
fn origin_on_the_retina_builtin() {
    let rects = rects_from_tao_report();
    let (x, y) = overlay_origin(&rects[0], 640.0);
    assert_eq!(x, (1512.0 - 640.0) / 2.0); // 436.0
    assert_eq!(y, 982.0 * OVERLAY_TOP_FRACTION); // 274.96
}

/// Same rule on a non-origin display: the monitor's own offset is part of the
/// answer, so the panel lands on that display and not the primary.
#[test]
fn origin_on_the_offset_external() {
    let rects = rects_from_tao_report();
    let (x, y) = overlay_origin(&rects[1], 640.0);
    assert_eq!(x, 1512.0 + (2560.0 - 640.0) / 2.0); // 2472.0
    assert_eq!(y, 1440.0 * OVERLAY_TOP_FRACTION); // 403.2
}
