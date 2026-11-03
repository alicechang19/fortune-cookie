import bpy, bmesh, sys, math, mathutils
src, outglb, outblend = sys.argv[-3:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o=[x for x in bpy.data.objects if x.type=='MESH'][0]
o.name='Cookie'; o.data.name='Cookie'
bpy.context.view_layer.objects.active=o; o.select_set(True)
try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as e: print("nocn",e)
m=o.modifiers.new('dec','DECIMATE'); m.ratio=0.016
bpy.ops.object.modifier_apply(modifier='dec')
print("faces", len(o.data.polygons))
# sit on the origin
bb=[mathutils.Vector(c) for c in o.bound_box]
mn=mathutils.Vector([min(v[i] for v in bb) for i in range(3)]); mx=mathutils.Vector([max(v[i] for v in bb) for i in range(3)])
o.data.transform(mathutils.Matrix.Translation((-(mn.x+mx.x)/2, -(mn.y+mx.y)/2, -mn.z)))
mat=o.data.materials[0]; mat.name='cookie'
import numpy as np
for im in bpy.data.images:
    s = 1024 if '_rm' in im.name else 2048
    im.scale(s, s)
    if 'basecolor' in im.name:
        # Tripo bakes light into the colour: lift the dark patches and calm the hot spots toward an even bake
        px=np.empty(s*s*4, dtype=np.float32); im.pixels.foreach_get(px); px=px.reshape(-1,4)
        rgb=px[:,:3]; L=rgb@np.array([0.299,0.587,0.114],dtype=np.float32)
        Lref=np.median(L[L>np.quantile(L,0.6)])
        C0=np.array([0.93,0.71,0.45],dtype=np.float32); C0*=Lref/(C0@np.array([0.299,0.587,0.114]))
        Ln=0.62*Lref+0.38*L
        sm=lambda a,b,x: (lambda t: t*t*(3-2*t))(np.clip((x-a)/(b-a),0,1))
        w=(sm(0.75*Lref,0.2*Lref,L)*0.75)[:,None]
        out=rgb*(Ln/np.maximum(L,1e-3))[:,None]
        out=out*(1-w)+(C0[None,:]*(Ln/Lref)[:,None])*w
        px[:,:3]=np.clip(out,0,1); im.pixels.foreach_set(px.ravel()); im.update()
        print("tex Lref", Lref)
uvname=o.data.uv_layers[0].name
# hollow it: Tripo gives a solid, a real cookie is a thin folded shell
from mathutils.bvhtree import BVHTree
imat=mat.copy(); imat.name='inside'; o.data.materials.append(imat)
bm=bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
bvh=BVHTree.FromBMesh(bm); TH=0.03
orig=list(bm.verts); offs={}
for v in orig:
    n=v.normal
    hit=bvh.ray_cast(v.co-n*1e-4, -n, 1.0)
    d=hit[3] if hit[0] is not None else 3*TH
    t=min(TH, 0.35*d)
    for _ in range(6):
        q=v.co-n*t
        loc,nn,_i,dist=bvh.find_nearest(q)
        # keep it only if it's inside the dough and not hugging some other part of the surface
        if loc is not None and (q-loc).dot(nn) < 0 and dist > 0.45*t: break
        t*=0.5
    else: t=0.0
    offs[v]=(v.co.copy(), n.copy(), t)
dup=bmesh.ops.duplicate(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces))
vmap=dup['vert_map']
for v_old,v_new in vmap.items():
    if v_old in offs: c,n,t=offs[v_old]; v_new.co=c-n*t
newf=[f for f in dup['geom'] if isinstance(f,bmesh.types.BMFace)]
bmesh.ops.reverse_faces(bm, faces=newf)
for f in newf: f.material_index=1
bm.to_mesh(o.data); bm.free()
print("hollow faces", len(o.data.polygons))
# jagged cutter: everything at x > f(y,z)
tri=lambda x:(2/math.pi)*math.asin(math.sin(x))
f=lambda y,z: 0.016*math.sin(z*13+1.2)+0.008*math.sin(y*23+2.1)+0.006*tri(z*41+y*29)+0.0035*tri(z*97+0.7)
bm=bmesh.new(); N=140
vs=[[bm.verts.new((f(-0.7+1.4*i/N, -0.2+1.0*j/N), -0.7+1.4*i/N, -0.2+1.0*j/N)) for j in range(N+1)] for i in range(N+1)]
for i in range(N):
    for j in range(N): bm.faces.new((vs[i][j],vs[i][j+1],vs[i+1][j+1],vs[i+1][j]))
bm.normal_update()
uv=bm.loops.layers.uv.new(uvname)
for fa in bm.faces:
    for l in fa.loops: l[uv].uv=(l.vert.co.y*2.2+0.5, l.vert.co.z*2.2)
r=bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
bmesh.ops.translate(bm, vec=(1.5,0,0), verts=[v for v in r['geom'] if isinstance(v,bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
cm=bpy.data.meshes.new('cutter'); bm.to_mesh(cm); bm.free()
cut=bpy.data.objects.new('Cutter',cm); bpy.context.collection.objects.link(cut)
bmat=bpy.data.materials.new('break'); bmat.diffuse_color=(0.85,0.6,0.3,1)
bmat.use_nodes=True; bmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.85,0.6,0.3,1)
cm.materials.append(bmat)
def half(name, op):
    h=o.copy(); h.data=o.data.copy(); h.name=name; h.data.name=name
    bpy.context.collection.objects.link(h)
    b=h.modifiers.new('cut','BOOLEAN'); b.operation=op; b.object=cut; b.solver='EXACT'
    b.material_mode='TRANSFER'; b.use_hole_tolerant=True
    bpy.context.view_layer.objects.active=h
    for x in bpy.context.selected_objects: x.select_set(False)
    h.select_set(True)
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    print(name, len(h.data.polygons), [mm.name for mm in h.data.materials], sum(1 for p in h.data.polygons if h.data.materials[p.material_index].name=='break'))
    return h
R=half('HalfR','INTERSECT'); L=half('HalfL','DIFFERENCE')
cut.hide_set(True); cut.hide_render=True
# keep the whole cookie for viewing, game halves in their own collection
game=bpy.data.collections.new('Game halves'); bpy.context.scene.collection.children.link(game)
for h in (L,R):
    bpy.context.collection.objects.unlink(h); game.objects.link(h)
lods=[]
for h in (L,R):
    d=h.copy(); d.data=h.data.copy(); d.name=h.name+'_lod'; d.data.name=d.name; game.objects.link(d)
    dm=d.modifiers.new('dec','DECIMATE'); dm.ratio=0.24
    bpy.context.view_layer.objects.active=d
    for x in bpy.context.selected_objects: x.select_set(False)
    d.select_set(True); bpy.ops.object.modifier_apply(modifier='dec')
    print(d.name, len(d.data.polygons)); lods.append(d)
for x in bpy.context.selected_objects: x.select_set(False)
L.select_set(True); R.select_set(True)
for d in lods: d.select_set(True)
bpy.ops.export_scene.gltf(filepath=outglb, use_selection=True, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT')
# staging for the .blend
o.hide_set(False)
for h in [L,R]+lods: h.hide_set(True); h.hide_render=True
sc=bpy.context.scene
cam=bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.lens=85; cam.location=(1.15,-2.6,1.35)
cam.rotation_euler=(mathutils.Vector((0,0,0.25))-cam.location).to_track_quat('-Z','Y').to_euler()
for nm,loc,en,sz in [('Key',(2,-2,3),300,1.5),('Fill',(-2.5,-1.5,1.5),90,2.5),('Rim',(0,2.5,2),160,1.5)]:
    ld=bpy.data.lights.new(nm,'AREA'); ld.energy=en; ld.size=sz; ld.color=(1,0.93,0.82)
    lo=bpy.data.objects.new(nm,ld); lo.location=loc; sc.collection.objects.link(lo)
    lo.rotation_euler=(mathutils.Vector((0,0,0.25))-lo.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=20); fl=bpy.context.active_object; fl.name='Floor'
fm=bpy.data.materials.new('floor'); fm.use_nodes=True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.84,0.76,0.62,1); fl.data.materials.append(fm)
w=bpy.data.worlds.new('World'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs['Color'].default_value=(0.86,0.79,0.67,1); w.node_tree.nodes['Background'].inputs['Strength'].default_value=0.6
sc.render.resolution_x=1600; sc.render.resolution_y=1200
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=outblend)
print("DONE")
