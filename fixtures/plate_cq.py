"""A CadQuery plate with four mounting holes. Exports through the module-level `result`."""
import cadquery as cq

result = (
    cq.Workplane("XY")
    .box(60, 40, 4)
    .faces(">Z")
    .workplane()
    .rect(48, 28, forConstruction=True)
    .vertices()
    .hole(4.2)
)
