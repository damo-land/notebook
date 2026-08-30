//! Pure geometry for placing the overlay on the display that holds the mouse
//! cursor.
//!
//! Everything in here works in **points** (macOS logical coordinates, global,
//! top-left origin — the space tao uses for `LogicalPosition`). That choice is
//! the whole module: tao reports each monitor's position/size in "physical"
//! pixels obtained by scaling that monitor's CGDisplayBounds (points) by *its
//! own* backing scale factor, and reports the cursor scaled by the *primary*
//! monitor's factor. On a mixed-DPI setup (this user's is 2.0/1.0/1.0) those
//! per-monitor physical rects live in incompatible spaces and can even
//! overlap each other, so containment tests on the raw physical numbers pick
//! the wrong display. Divide everything back to points first and the rects
//! tile the desktop exactly as CGDisplayBounds describes it.
//!
//! Pure functions, no AppKit: `pick_monitor` and `overlay_origin` are unit
//! tested (tests/overlay_placement.rs), including the 2x-primary case where
//! the physical-space rects overlap.

/// A monitor's bounds in points, global top-left-origin coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    /// Half-open containment: the right/bottom edge belongs to the neighbour,
    /// so a cursor on a shared edge matches exactly one display.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }

    /// Squared distance from a point to this rect (0 inside). Used only to
    /// break ties when the cursor is momentarily outside every rect.
    fn distance_sq(&self, x: f64, y: f64) -> f64 {
        let dx = (self.x - x).max(x - (self.x + self.width)).max(0.0);
        let dy = (self.y - y).max(y - (self.y + self.height)).max(0.0);
        dx * dx + dy * dy
    }
}

/// A degenerate scale factor is treated as 1.0 rather than dividing by zero.
fn sane_scale(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

/// Converts one monitor's tao-reported physical position and size back to
/// points, using that monitor's own scale factor — the inverse of how tao
/// produced them.
pub fn monitor_rect_points(position: (f64, f64), size: (f64, f64), scale: f64) -> Rect {
    let scale = sane_scale(scale);
    Rect {
        x: position.0 / scale,
        y: position.1 / scale,
        width: size.0 / scale,
        height: size.1 / scale,
    }
}

/// Converts the tao-reported cursor position back to points. tao scales the
/// cursor by the **primary** monitor's factor regardless of which display the
/// cursor is on, so that is the factor to undo.
pub fn cursor_points(cursor: (f64, f64), primary_scale: f64) -> (f64, f64) {
    let scale = sane_scale(primary_scale);
    (cursor.0 / scale, cursor.1 / scale)
}

/// The monitor holding the cursor: the containing rect, or — when the cursor
/// sits fractionally outside every rect, which macOS permits at corners — the
/// nearest one. `None` only for an empty slice.
pub fn pick_monitor(cursor: (f64, f64), monitors: &[Rect]) -> Option<usize> {
    if let Some(idx) = monitors.iter().position(|m| m.contains(cursor.0, cursor.1)) {
        return Some(idx);
    }
    monitors
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            a.distance_sq(cursor.0, cursor.1)
                .total_cmp(&b.distance_sq(cursor.0, cursor.1))
        })
        .map(|(idx, _)| idx)
}

/// Where the overlay's top edge sits, as a fraction of the chosen display's
/// height. Spotlight sits at roughly this height; the acceptance range for
/// this task is 25–30%.
pub const OVERLAY_TOP_FRACTION: f64 = 0.28;

/// Top-left origin for the overlay on `monitor`, in points: horizontally
/// centered, top edge at [`OVERLAY_TOP_FRACTION`] of the display's height.
/// Computed fresh on every show, so a dynamic-height resize from a previous
/// session can never leave a stale anchor.
pub fn overlay_origin(monitor: &Rect, panel_width: f64) -> (f64, f64) {
    (
        monitor.x + (monitor.width - panel_width) / 2.0,
        monitor.y + monitor.height * OVERLAY_TOP_FRACTION,
    )
}
