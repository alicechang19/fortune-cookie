"""Procedural fortune cookie for Blender 5.x.

Run headless (writes fortune_cookie.blend next to this file, optionally renders):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P fortune_cookie.py -- --render out.png
Options after "--":  --render PATH   --samples N   --pct PERCENT
Or open Blender's Scripting tab, open this file and press Run Script.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = lambda k, d: type(d)(argv[argv.index(k) + 1]) if k in argv else d
RENDER_PATH = opt("--render", "")
SAMPLES = opt("--samples", 192)
PCT = opt("--pct", 100)
ROT_Z = opt("--rotz", 71.0)

# ---------------------------------------------------------------- parameters
# Every shape setting can be overridden on the command line, e.g. --close 0.9
R = 1.0                                 # radius of the flat dough disc
GRID = 140                              # grid resolution of the disc
CLOSE = opt("--close", 0.95)            # how far the half-moon is rolled into a cone (1 = seam shut)
WIDTH = opt("--width", 1.45)            # stretch of the cone side to side (across the seam)
DEPTH = opt("--depth", 0.55)            # stretch front to back (along the seam)
HEIGHT = opt("--height", 1.35)          # squash of the cone's height
FLARE = opt("--flare", 0.10)            # how much the rim spreads out at the base
END_LIFT = opt("--lift", 0.40)          # the rim curls up at the two side ends
POCKET = opt("--pocket", 0.22)          # how far the two dough layers puff apart into lobes
INNER = opt("--inner", 0.35)            # the inner layer puffs this much as much as the outer
LOBE_EDGE = opt("--lobe_edge", 0.35)    # smaller = lobes stay fat right up to the seam
RIM_GAP = opt("--rim_gap", 0.035)       # the two layers part slightly at the rim
THICK = 0.045           # dough thickness
FORTUNE = "You will render\ngreat things."
LUCKY = "Lucky numbers  3  8  21  42"

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def link(obj):
    scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- cookie shape
def square_to_disc(u, v):
    """Map [-1,1]^2 onto the unit disc, keeping the u = 0 line (the crease) straight."""
    return u * math.sqrt(1 - v * v / 2), v * math.sqrt(1 - u * u / 2)


# A half-disc of radius R rolled into a cone with apex at its centre: its arc
# (length pi*R) wraps CLOSE of the way round, which fixes the cone's half-angle.
CONE_SIN = min(1 / (2 * CLOSE), 0.999)
CONE_COS = math.sqrt(1 - CONE_SIN ** 2)
PEAK_ROUND = 0.08 * R                  # rounds off the point of the cone


def mid_surface(r, alpha):
    """Middle sheet of the cookie, between its two dough layers.

    Fold the disc in half and you get a sealed half-moon. In polar coordinates
    about the centre of the folded edge, r runs out to the rim and alpha sweeps
    from one end of the folded edge (0) round to the other (pi).  Pressing that
    centre point over a cup rim and pulling the two ends down and together rolls
    the half-moon into a squat cone: the centre becomes the peak, the two halves
    of the folded edge come together down the front as the V-shaped seam, and
    the sealed rim becomes the base that sits on the table.
    Returns the point and the outward normal.
    """
    phi = (alpha - math.pi / 2) * 2 * CLOSE        # 0 = back of the cone, +-pi = front seam
    t = r / R
    spread = 1 + FLARE * t * t
    d = Vector((math.sin(phi), math.cos(phi)))     # +Y is the back, -Y the seam side
    p = Vector((r * CONE_SIN * spread * d.x * WIDTH,
                r * CONE_SIN * spread * d.y * DEPTH,
                -(math.hypot(r, PEAK_ROUND) - PEAK_ROUND) * CONE_COS * HEIGHT
                + END_LIFT * t ** 3 * d.x ** 2))
    n = Vector((CONE_COS * d.x / WIDTH, CONE_COS * d.y / DEPTH, CONE_SIN / HEIGHT)).normalized()
    return p, n


def fold_and_bend(x, y):
    """Map a point (x, y) of the flat disc onto the finished cookie.

    The folded edge is x = 0; the two halves (x > 0, x < 0) become the outer and
    inner dough layers. They touch along the folded edge and the sealed rim and
    puff apart in between, which is what makes the two rounded lobes.
    """
    layer = 1.0 if x >= 0 else -1.0
    s = abs(x)
    r = min(math.hypot(s, y), R)
    alpha = math.atan2(s, y)                       # 0 .. pi
    t = r / R
    # layers hug at the peak, the folded edge and the rim; fat lobes in between
    near_peak = min(t / 0.35, 1.0) ** 2 * (3 - 2 * min(t / 0.35, 1.0))
    lobe = math.sin(alpha) ** LOBE_EDGE * (4 * t * (1 - t)) ** 0.5 * near_peak
    puff = (POCKET * lobe + RIM_GAP * t ** 8) * (1.0 if layer > 0 else INNER)
    p, n = mid_surface(r, alpha)
    return p + layer * puff * n


bm = bmesh.new()
rim_layer = bm.verts.layers.float.new("rim")
verts = {}
for i in range(GRID + 1):
    for j in range(GRID + 1):
        x, y = square_to_disc(-1 + 2 * i / GRID, -1 + 2 * j / GRID)
        v = bm.verts.new(fold_and_bend(x * R, y * R))
        v[rim_layer] = math.hypot(x, y)       # 0 at the disc centre, 1 at its edge
        verts[i, j] = v
for i in range(GRID):
    for j in range(GRID):
        bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
bm.normal_update()

mesh = bpy.data.meshes.new("FortuneCookie")
bm.to_mesh(mesh)
bm.free()
mesh.shade_smooth()
cookie = link(bpy.data.objects.new("FortuneCookie", mesh))

solid = cookie.modifiers.new("Thickness", "SOLIDIFY")
solid.thickness = THICK
solid.offset = 0.0
solid.use_even_offset = False   # even offset spikes at the 180-degree fold

lumps = bpy.data.textures.new("DoughLumps", "CLOUDS")
lumps.noise_scale = 0.3
lumps.noise_depth = 2
disp = cookie.modifiers.new("Lumps", "DISPLACE")
disp.texture = lumps
disp.strength = 0.02
disp.texture_coords = "GLOBAL"

sub = cookie.modifiers.new("Smooth", "SUBSURF")
sub.levels = 1
sub.render_levels = 2


# ---------------------------------------------------------------- materials
def principled(name, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    for key, value in inputs.items():
        for n in key.split("|"):              # tolerate renamed sockets
            if n in bsdf.inputs:
                bsdf.inputs[n].default_value = value
                break
    return mat, mat.node_tree, bsdf


# Baked dough: golden body, toasted patches, browner thin edges, tiny pits.
mat, nt, bsdf = principled(
    "BakedDough", Roughness=0.55, **{
        "Subsurface Weight|Subsurface": 0.12,
        "Subsurface Radius": (0.4, 0.18, 0.05),
        "Subsurface Scale": 0.04,
        "Coat Weight": 0.05, "Coat Roughness": 0.4})
N, L = nt.nodes, nt.links
coord = N.new("ShaderNodeTexCoord")
blotch = N.new("ShaderNodeTexNoise")
blotch.inputs["Scale"].default_value = 2.5
blotch.inputs["Detail"].default_value = 8.0
blotch.inputs["Roughness"].default_value = 0.6
L.new(coord.outputs["Object"], blotch.inputs["Vector"])

rim = N.new("ShaderNodeAttribute")
rim.attribute_name = "rim"
edge = N.new("ShaderNodeMapRange")             # 0 inside -> 1 at the toasted rim
edge.inputs["From Min"].default_value = 0.88
edge.inputs["From Max"].default_value = 1.0
L.new(rim.outputs["Fac"], edge.inputs["Value"])

toast = N.new("ShaderNodeMath")
toast.operation = "MULTIPLY_ADD"               # blotch*0.7 + edge
toast.use_clamp = True
toast.inputs[1].default_value = 0.9
L.new(blotch.outputs["Fac"], toast.inputs[0])
edge.inputs["To Max"].default_value = 0.45
L.new(edge.outputs["Result"], toast.inputs[2])

ramp = N.new("ShaderNodeValToRGB")
els = ramp.color_ramp.elements
els[0].position, els[0].color = 0.25, (0.80, 0.55, 0.26, 1)   # pale sandy gold
els[1].position, els[1].color = 0.95, (0.26, 0.10, 0.025, 1)  # toasted brown
mid = els.new(0.5)
mid.color = (0.66, 0.40, 0.15, 1)                              # golden
L.new(toast.outputs["Value"], ramp.inputs["Fac"])
L.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

pits = N.new("ShaderNodeTexNoise")
pits.inputs["Scale"].default_value = 120.0
pits.inputs["Detail"].default_value = 3.0
bump = N.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.45
bump.inputs["Distance"].default_value = 0.004
L.new(coord.outputs["Object"], pits.inputs["Vector"])
L.new(pits.outputs["Fac"], bump.inputs["Height"])
L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
cookie.data.materials.append(mat)

paper_mat, _, _ = principled("Paper", Roughness=0.85, **{
    "Base Color": (0.92, 0.90, 0.84, 1), "Subsurface Weight|Subsurface": 0.25,
    "Subsurface Radius": (0.5, 0.5, 0.5), "Subsurface Scale": 0.01})
ink_mat, _, _ = principled("RedInk", Roughness=0.55, **{"Base Color": (0.50, 0.02, 0.02, 1)})

table_mat, tnt, tb = principled("WalnutTable", Roughness=0.55)
wave = tnt.nodes.new("ShaderNodeTexWave")
tco = tnt.nodes.new("ShaderNodeTexCoord")
tmap = tnt.nodes.new("ShaderNodeMapping")
tmap.inputs["Scale"].default_value = (0.15, 1.0, 1.0)   # stretch grain along X
tnt.links.new(tco.outputs["Object"], tmap.inputs["Vector"])
tnt.links.new(tmap.outputs["Vector"], wave.inputs["Vector"])
wave.inputs["Scale"].default_value = 1.5
wave.inputs["Distortion"].default_value = 3.5
wave.inputs["Detail"].default_value = 5.0
wave.inputs["Detail Roughness"].default_value = 0.7
tramp = tnt.nodes.new("ShaderNodeValToRGB")
tramp.color_ramp.elements[0].color = (0.035, 0.016, 0.008, 1)
tramp.color_ramp.elements[1].color = (0.11, 0.05, 0.022, 1)
tnt.links.new(wave.outputs["Fac"], tramp.inputs["Fac"])
tnt.links.new(tramp.outputs["Color"], tb.inputs["Base Color"])

# ---------------------------------------------------------------- fortune slip
# A flat strip lying in the pocket between the layers, sliding out of the slit.
SLIP_LEN, SLIP_W = 0.95, 0.2
bpy.ops.mesh.primitive_plane_add(size=1)
paper = bpy.context.active_object
paper.name = "FortuneSlip"
paper.scale = (SLIP_LEN, SLIP_W, 1)
bpy.ops.object.transform_apply(scale=True)
psolid = paper.modifiers.new("Thickness", "SOLIDIFY")
psolid.thickness = 0.004
psolid.offset = 0.0
paper.data.materials.append(paper_mat)
paper.parent = cookie
# Lie the slip on the table, partly under the cookie, coming out through the V seam.
_front, _ = mid_surface(R, 0.0)               # where one end of the folded edge lands
SLIP_TUCK = 0.35                               # length left inside the cookie
_ang = math.radians(-90 + 25)                  # out of the front, angled a little to one side
_dir = Vector((math.cos(_ang), math.sin(_ang), 0))
_centre = Vector((0, _front.y * 0.9, _front.z + 0.004)) + _dir * (SLIP_LEN / 2 - SLIP_TUCK)
paper.matrix_basis = Matrix.Translation(_centre) @ Matrix.Rotation(_ang, 4, "Z")


def add_text(name, body, size, loc, flip=False):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.align_x = curve.align_y = "CENTER"
    curve.size = size
    curve.space_line = 1.1
    obj = link(bpy.data.objects.new(name, curve))
    obj.data.materials.append(ink_mat)
    obj.parent = paper
    obj.location = loc
    # the back side is flipped over so it reads from underneath
    obj.rotation_euler = (math.pi if flip else 0, 0, 0)
    return obj


# Centre the printing on the part of the slip outside the cookie.
_tx = SLIP_TUCK / 2 + 0.02
add_text("Fortune", FORTUNE, 0.045, (_tx, 0, 0.0025))
add_text("LuckyNumbers", LUCKY, 0.028, (_tx, 0, -0.0025), flip=True)

# ---------------------------------------------------------------- staging
# The mesh already stands on its feet; just turn it to face the camera.
cookie.rotation_euler = (0, 0, math.radians(ROT_Z))
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = cookie.evaluated_get(dg)
pts = [ev.matrix_world @ v.co for v in ev.to_mesh().vertices]
ev.to_mesh_clear()
cookie.location.z -= min(p.z for p in pts)
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
centre = (lo + hi) / 2 + cookie.location - Vector((0, 0, 0))
centre.z = (hi.z - lo.z) * 0.45

bpy.ops.mesh.primitive_plane_add(size=40)
table = bpy.context.active_object
table.name = "Table"
table.rotation_euler.z = math.radians(20)
table.data.materials.append(table_mat)


def area(name, loc, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.size, data.color = energy, size, color
    obj = link(bpy.data.objects.new(name, data))
    obj.location = loc
    obj.rotation_euler = (centre - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


area("Key", (3.0, -3.2, 4.2), 520, 2.5, (1.0, 0.90, 0.78))
area("Fill", (-4.5, -2.5, 1.8), 90, 5.0, (0.75, 0.85, 1.0))
area("Rim", (-1.0, 4.5, 2.6), 650, 1.5, (1.0, 0.93, 0.85))

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.010, 0.009, 1)
scene.world = world

cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 85
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = 2.8
cam = link(bpy.data.objects.new("Camera", cam_data))
cam.location = centre + Vector((2.9, -6.0, 2.9)) * 0.8
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.dof.focus_distance = (centre - cam.location).length
scene.camera = cam

# ---------------------------------------------------------------- render
try:
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
except Exception as e:
    print("Cycles unavailable, using EEVEE:", e)
    scene.render.engine = "BLENDER_EEVEE"

scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.resolution_percentage = PCT

# Open in Blender looking through the camera with materials and scene lights on.
for screen in bpy.data.screens:
    for area_ in screen.areas:
        if area_.type == "VIEW_3D":
            space = area_.spaces.active
            space.shading.type = "MATERIAL"
            space.shading.use_scene_lights = True
            space.shading.use_scene_world = True
            space.region_3d.view_perspective = "CAMERA"
            space.overlay.show_floor = False

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "fortune_cookie.blend"))
if RENDER_PATH:
    scene.render.filepath = RENDER_PATH
    bpy.ops.render.render(write_still=True)
