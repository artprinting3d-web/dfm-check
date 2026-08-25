// A wall bracket with a horizontal shelf: the underside of the shelf is a 90-degree
// overhang over nothing, which is exactly what the DFM check should report.
wall_t   = 3;
shelf_t  = 4;
width    = 40;
height   = 50;
depth    = 30;

union() {
    cube([wall_t, width, height]);
    translate([wall_t, 0, height - shelf_t])
        cube([depth, width, shelf_t]);
}
