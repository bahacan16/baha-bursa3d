"""Pişirilmiş dolaylı ışık — Blender (bpy 4.2) pişirme adımı (docs/BAKE.md §Hat 2).

Girdi: scripts/bake-export.mjs çıktısı (BAKE_WORK/src: chunk_<cx>_<cz>.glb [uv1'li], occluders.glb, export.json).
Çıktı: BAKE_OUT (varsayılan public/bake): ao_<n>.webp sayfaları, ground_ao.webp, manifest.json.

Çalıştırma (Blender kurmadan, Python modülü olarak):
    pip install bpy==4.2.0 pillow numpy
    python blender/bake/bake_ao.py
ya da Blender ile:  blender --background --python blender/bake/bake_ao.py

Ortam değişkenleri (hepsi isteğe bağlı):
    BAKE_WORK=bake-work      BAKE_OUT=public/bake
    BAKE_METHOD=ratio|ao     ratio: gerçek dolaylı oran (DIFFUSE pişirme ÷ açık alan değeri), ao: Cycles AO
    BAKE_SAMPLES=64          örnek (ratio); AO için BAKE_AO_SAMPLES=64, BAKE_AO_DIST=25
    BAKE_BOUNCES=3           yayınık sekme
    BAKE_CHUNKS=             virgüllü parça listesi (boş = export.json'daki tümü)
    BAKE_DENOISE=1           OIDN (compositor) gürültü giderme
    BAKE_TIME_BUDGET=9000    s; ilk büyük parçadan kestirilen toplam süre aşarsa örnek düşürülür, yetmezse AO'ya geçilir
    BAKE_PAGE=8192           sayfa kenarı (px)
    BAKE_GROUND_MPP=0.25     zemin AO çözünürlüğü (m/px); 0 = zemin pişirme yok
    BAKE_QUALITY=88          WebP kalitesi
    BAKE_THREADS=0           0 = tüm çekirdekler
    BAKE_MARGIN_M=60         parça başına sahneye alınan çevre (m); uzaktakiler Cycles'tan gizlenir

Yöntem (ratio): beyaz gökyüzü (1.0), lamba yok, tüm yüzeyler yayınık albedo 0.6. Her doku pikselinde Cycles DIFFUSE
(yalnız ışık, renk yok) = gelen dolaylı ışınım / π. Açık düz alanda aynı normalin alacağı değer
E0(n) = (1+n_up)/2 + 0.6·(1−n_up)/2 ile bölünür → 0..1 oran (oyundaki ortam ışığı zaten gök/zemin yarım küresini
normal yönüne göre veriyor). Oyunda aoMap (uv1) olarak yalnız dolaylı ışığı çarpar.
"""

import json
import math
import os
import re
import sys
import time

import bpy
import numpy as np

try:
    from PIL import Image as PILImage
except Exception:  # pragma: no cover
    PILImage = None


def env(name, default):
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return type(default)(v) if not isinstance(default, str) else v


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORK = os.path.abspath(env("BAKE_WORK", os.path.join(ROOT, "bake-work")))
SRC = os.path.join(WORK, "src")
OUT = os.path.abspath(env("BAKE_OUT", os.path.join(ROOT, "public", "bake")))
METHOD = env("BAKE_METHOD", "ratio")
SAMPLES = env("BAKE_SAMPLES", 64)
AO_SAMPLES = env("BAKE_AO_SAMPLES", 64)
AO_DIST = env("BAKE_AO_DIST", 25.0)
BOUNCES = env("BAKE_BOUNCES", 3)
DENOISE = env("BAKE_DENOISE", 1)
BUDGET = env("BAKE_TIME_BUDGET", 9000.0)
PAGE = env("BAKE_PAGE", 8192)
GROUND_MPP = env("BAKE_GROUND_MPP", 0.25)
QUALITY = env("BAKE_QUALITY", 88)
THREADS = env("BAKE_THREADS", 0)
ALBEDO = 0.6
MARGIN_PX = 2
OCC_MARGIN = env("BAKE_MARGIN_M", 60.0)  # m; pişirilen parçadan bu kadar uzaktaki nesneler gizlenir
GROUND_LIFT = 0.25  # zemin AO düzlemi gerçek araziden bu kadar yukarıda (döşeme katmanları engellemesin)

T0 = time.time()


def log(*a):
    print(f"[bake {time.time() - T0:7.1f}s]", *a, flush=True)


# ---------------------------------------------------------------- sahne
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = BOUNCES + 1
    sc.cycles.diffuse_bounces = BOUNCES
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.volume_bounces = 0
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.use_auto_tile = False
    if THREADS > 0:
        sc.render.threads_mode = "FIXED"
        sc.render.threads = THREADS
    w = bpy.data.worlds.new("bake_sky")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    w.light_settings.distance = AO_DIST
    return sc


_mats = {}


def bake_material(name, alpha, image=None):
    """alpha: 1 = opak yayınık; <1 = saydam karışım (cam, su, yaprak kartı, ağaç tacı)."""
    key = (name, round(alpha, 2), image is not None)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f"{name}_{'recv' if image else 'occ'}_{alpha:.2f}")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (ALBEDO, ALBEDO, ALBEDO, 1)
    if alpha < 0.999:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(dif.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(dif.outputs[0], out.inputs["Surface"])
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "bake_target"
        tex.image = image
        nt.nodes.active = tex
    _mats[key] = m
    return m


def key_alpha(info):
    """Malzeme bilgisinden pişirmedeki opaklık"""
    if not info:
        return 1.0
    if info.get("alphaTest", 0) > 0:
        return 0.55  # yaprak kartı: boşluklu
    if info.get("transparent"):
        return max(0.1, min(1.0, float(info.get("opacity", 1.0))) * 0.8)
    return 1.0


def strip_suffix(name):
    return re.sub(r"\.\d{3}$", "", name)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=False, import_shading="NORMALS")
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def join(objs, name):
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        o.parent = None
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    # Nesne uzayı = dünya uzayı (normal pişirmesi OBJECT uzayında)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def classify_slots(obj, keys, prefix=""):
    """Her malzeme yuvası için opaklık sınıfı; yuvalar ortak engelleyici malzemelerine bağlanır."""
    classes = []
    for i, slot in enumerate(obj.material_slots):
        nm = strip_suffix(slot.material.name) if slot.material else ""
        if prefix and nm.startswith(prefix):
            nm = nm[len(prefix):]
        a = key_alpha(keys.get(nm))
        classes.append(a)
        obj.data.materials[i] = bake_material("occ", a)
    return classes


# ---------------------------------------------------------------- görüntü yardımcıları
def image_array(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def set_image(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.update()


_dn_scene = None


def denoise(img):
    """OIDN (compositor Denoise düğümü) ile; ayrı boş Workbench sahnesinde (sahne yeniden işlenmez)."""
    global _dn_scene
    w, h = img.size
    if _dn_scene is None:
        s = bpy.data.scenes.new("bake_denoise")
        s.render.engine = "BLENDER_WORKBENCH"
        s.use_nodes = True
        s.view_settings.view_transform = "Standard"
        s.render.image_settings.file_format = "OPEN_EXR"
        s.render.image_settings.color_depth = "32"
        s.render.resolution_percentage = 100
        _dn_scene = s
    s = _dn_scene
    s.render.resolution_x = w
    s.render.resolution_y = h
    nt = s.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    i = nt.nodes.new("CompositorNodeImage")
    i.image = img
    d = nt.nodes.new("CompositorNodeDenoise")
    d.prefilter = "ACCURATE"
    c = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(i.outputs[0], d.inputs[0])
    nt.links.new(d.outputs[0], c.inputs[0])
    bpy.ops.render.render(scene=s.name)
    path = os.path.join(WORK, "_dn.exr")
    bpy.data.images["Render Result"].save_render(path, scene=s)
    r = bpy.data.images.load(path)
    arr = image_array(r)
    bpy.data.images.remove(r)
    return arr


def to_u8_top(arr):
    """Blender (satır 0 = alt) → dosya (satır 0 = üst = glTF v=0)"""
    return np.clip(np.flipud(arr) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_grey(u8, path):
    if PILImage is not None:
        PILImage.fromarray(u8, "L").save(path, "WEBP", quality=QUALITY, method=6)
        return
    h, w = u8.shape
    img = bpy.data.images.new("save_tmp", w, h)
    f = np.flipud(u8).astype(np.float32) / 255.0
    set_image(img, np.dstack([f, f, f, np.ones_like(f)]))
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "WEBP"
    sc.render.image_settings.color_mode = "BW"
    sc.render.image_settings.quality = QUALITY
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)


# ---------------------------------------------------------------- pişirme
def do_bake(obj, image, method, samples):
    """obj'nin tüm yuvaları alıcı malzemeye (image hedefli) geçirilir, pişirilir, geri alınır."""
    sc = bpy.context.scene
    classes = obj["bake_classes"]
    for i, a in enumerate(classes):
        obj.data.materials[i] = bake_material("recv", a, image)
        m = obj.data.materials[i]
        m.node_tree.nodes["bake_target"].image = image
        m.node_tree.nodes.active = m.node_tree.nodes["bake_target"]
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    sc.render.bake.margin = MARGIN_PX
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_clear = False
    sc.render.bake.target = "IMAGE_TEXTURES"
    if method == "normal":
        sc.cycles.samples = 1
        bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=MARGIN_PX, use_clear=False)
    elif method == "ao":
        sc.cycles.samples = samples
        bpy.ops.object.bake(type="AO", margin=MARGIN_PX, use_clear=False)
    else:
        sc.cycles.samples = samples
        bpy.ops.object.bake(
            type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=MARGIN_PX, use_clear=False
        )
    for i, a in enumerate(classes):
        obj.data.materials[i] = bake_material("occ", a)


_bounds = {}


def game_bounds(o):
    """Nesnenin oyun uzayındaki (x, z) sınır kutusu, önbellekli"""
    if o.name not in _bounds:
        from mathutils import Vector

        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        xs = [p.x for p in pts]
        zs = [-p.y for p in pts]
        _bounds[o.name] = (min(xs), min(zs), max(xs), max(zs))
    return _bounds[o.name]


def isolate(rect, margin, keep=()):
    """Pişirilen bölgeden `margin` m'den uzaktaki nesneleri Cycles'tan gizle (bellek + BVH süresi)."""
    x0, z0, x1, z1 = rect[0] - margin, rect[1] - margin, rect[2] + margin, rect[3] + margin
    shown = 0
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        if o in keep:
            o.hide_render = False
            continue
        if o.name.startswith("ground_ao"):
            o.hide_render = True
            continue
        b = game_bounds(o)
        vis = b[2] >= x0 and b[0] <= x1 and b[3] >= z0 and b[1] <= z1
        o.hide_render = not vis
        shown += vis
    return shown


def new_image(name, w, h, fill):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    set_image(img, np.full((h, w, 4), fill, dtype=np.float32))
    return img


def bake_chunk(obj, size, method, samples):
    """Parça atlası → 0..1 oran (float, Blender satır düzeni)"""
    img = new_image(f"lm_{obj.name}", size, size, -1.0)
    t = time.time()
    do_bake(obj, img, method, samples)
    light = image_array(img)[..., 0].copy()
    t_bake = time.time() - t
    covered = light > -0.5
    if method == "ratio":
        nimg = new_image(f"nm_{obj.name}", size, size, 0.0)
        do_bake(obj, nimg, "normal", 1)
        nz = image_array(nimg)[..., 2] * 2.0 - 1.0  # nesne uzayı = dünya, Blender Z = yukarı
        bpy.data.images.remove(nimg)
        e0 = (1.0 + nz) * 0.5 + ALBEDO * (1.0 - nz) * 0.5
        val = np.where(covered, light / np.maximum(e0, 0.05), 1.0)
    else:
        val = np.where(covered, light, 1.0)
    val = np.clip(val, 0.0, 1.0)
    if DENOISE:
        a = np.zeros((size, size, 4), dtype=np.float32)
        a[..., 0] = a[..., 1] = a[..., 2] = val
        a[..., 3] = 1
        set_image(img, a)
        d = denoise(img)[..., 0]
        # Kapsanmayan pikseller (adalar arası) gürültü gidericiden gelen değeri almasın
        val = np.clip(np.where(covered, d, val), 0.0, 1.0)
    bpy.data.images.remove(img)
    return val, t_bake, float(covered.mean())


def pack_pages(chunks, page):
    """2'nin kuvveti kareleri sayfalara (dörtlü ağaç) yerleştir; büyükten küçüğe, kararlı."""
    order = sorted(range(len(chunks)), key=lambda i: (-chunks[i]["size"], i))
    pages = []  # her sayfa: boş kareler listesi (x, y, s)

    def alloc(s):
        for pi, free in enumerate(pages):
            free.sort(key=lambda r: (r[2], r[1], r[0]))
            for j, (x, y, fs) in enumerate(free):
                if fs >= s:
                    free.pop(j)
                    while fs > s:
                        fs //= 2
                        free += [(x + fs, y, fs), (x, y + fs, fs), (x + fs, y + fs, fs)]
                    return pi, x, y
        pages.append([(0, 0, page)])
        return alloc(s)

    for i in order:
        pi, x, y = alloc(chunks[i]["size"])
        chunks[i]["page"] = pi
        chunks[i]["rect"] = [x, y, chunks[i]["size"]]
    return len(pages)


def ground_object(terrain, rect, drop):
    """Arazi vekilinin bölge içindeki kopyası, GROUND_LIFT yukarıda, düzlemsel uv (dünya xz → 0..1)."""
    x0, z0, x1, z1 = rect
    me = terrain.data.copy()
    ob = bpy.data.objects.new("ground_ao", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = terrain.matrix_world.copy()
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(me)
    # Bölge dışında kalan yüzleri at (payı kadar genişletilmiş)
    dead = [
        f
        for f in bm.faces
        if not (x0 - 12 < f.calc_center_median().x < x1 + 12 and z0 - 12 < -f.calc_center_median().y < z1 + 12)
    ]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    for v in bm.verts:
        v.co.z += GROUND_LIFT + drop
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for lp in f.loops:
            x = lp.vert.co.x
            z = -lp.vert.co.y
            # dosya satırı 0 = z0 (kuzey) → Blender v = 1 − (z − z0)/(z1 − z0)
            lp[uv].uv = ((x - x0) / (x1 - x0), 1.0 - (z - z0) / (z1 - z0))
    bm.to_mesh(me)
    bm.free()
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.active_index = 0
    ob.data.materials.clear()
    ob.data.materials.append(bake_material("occ", 1.0))
    ob["bake_classes"] = [1.0]
    return ob


# ---------------------------------------------------------------- ana akış
def main():
    exp = json.load(open(os.path.join(SRC, "export.json")))
    keys = exp["keys"]
    want = [c for c in os.environ.get("BAKE_CHUNKS", "").split(",") if c]
    chunks = [c for c in exp["chunks"] if not want or c["id"] in want]
    log(f"{len(chunks)} parça pişirilecek ({METHOD}, {SAMPLES} örnek, {BOUNCES} sekme), çıktı {OUT}")
    setup_scene()

    # Engelleyiciler
    occ = import_glb(os.path.join(SRC, exp["occluders"]))
    terrain = None
    for o in occ:
        nm = strip_suffix(o.name)
        if nm.startswith("occ_terrain"):
            terrain = o
        if nm.startswith("occ_canopy"):
            o.data.materials.clear()
            o.data.materials.append(bake_material("occ", 0.65))
        elif nm.startswith("occ_mk_"):
            classify_slots(o, keys, "")
        else:
            o.data.materials.clear()
            o.data.materials.append(bake_material("occ", 1.0))
    log(f"engelleyiciler: {len(occ)} nesne")

    # Parçalar (pişirilecekler + yalnız engelleyici komşular)
    objs = {}
    todo = list(chunks) + [c for c in exp.get("occluderChunks", []) if c["id"] not in {x["id"] for x in chunks}]
    if want:
        todo += [
            c
            for c in exp["chunks"]
            if c["id"] not in {x["id"] for x in todo}
            and c["bbox"][2] > min(x["bbox"][0] for x in chunks) - 60
            and c["bbox"][0] < max(x["bbox"][2] for x in chunks) + 60
            and c["bbox"][3] > min(x["bbox"][1] for x in chunks) - 60
            and c["bbox"][1] < max(x["bbox"][3] for x in chunks) + 60
            and os.path.exists(os.path.join(SRC, f"chunk_{c['id']}.glb"))
        ]
    tris = 0
    for c in todo:
        parts = import_glb(os.path.join(SRC, c.get("file", f"chunk_{c['id']}.glb")))
        o = join(parts, f"chunk_{c['id']}")
        if o is None:
            continue
        me = o.data
        # uv1 (TEXCOORD_1) etkin → pişirme hedefi
        if len(me.uv_layers) >= 2:
            me.uv_layers.active_index = 1
            me.uv_layers[1].active_render = True
        o["bake_classes"] = classify_slots(o, keys)
        objs[c["id"]] = o
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    log(f"{len(objs)} parça nesnesi, ~{tris} üçgen içe alındı")

    method, samples = METHOD, SAMPLES
    results = []
    order = sorted(chunks, key=lambda c: -c["size"])
    total_px = sum(c["size"] ** 2 for c in order)
    done_px = 0
    t_start = time.time()
    for n, c in enumerate(order):
        o = objs.get(c["id"])
        if o is None:
            continue
        isolate(c["bbox"], OCC_MARGIN, keep=(o,))
        val, tb, cov = bake_chunk(o, c["size"], method, samples)
        done_px += c["size"] ** 2
        el = time.time() - t_start
        log(f"  {c['id']}: {c['size']}² ({cov * 100:.0f}% dolu) pişirme {tb:.1f}s, toplam {el:.0f}s")
        # Süre kestirimi (ilk parçadan sonra): bütçe aşılırsa örnek düşür / AO'ya geç, baştan başla
        if n == 0 and len(order) > 1:
            est = el * total_px / max(1, done_px)
            log(f"  kestirilen toplam süre {est / 60:.0f} dk (bütçe {BUDGET / 60:.0f} dk)")
            if est > BUDGET:
                f = BUDGET / est
                if method == "ratio" and samples * f >= 16:
                    samples = max(16, int(samples * f * 0.9))
                    log(f"  bütçe: örnek {SAMPLES} → {samples}")
                else:
                    method, samples = "ao", max(16, min(AO_SAMPLES, int(AO_SAMPLES * f * 2)))
                    log(f"  bütçe: AO pişirmesine geçildi ({samples} örnek)")
                val, tb, cov = bake_chunk(o, c["size"], method, samples)
        c["_val"] = val
        results.append(c)

    # Sayfalar
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if re.match(r"^(ao_\d+|ground_ao)\.webp$", f):
            os.remove(os.path.join(OUT, f))
    npages = pack_pages(results, PAGE)
    pages = []
    for p in range(npages):
        members = [c for c in results if c["page"] == p]
        used = max(max(c["rect"][0] + c["size"], c["rect"][1] + c["size"]) for c in members)
        side = 1
        while side < used:
            side *= 2
        arr = np.full((side, side), 255, dtype=np.uint8)
        for c in members:
            x, y, s = c["rect"]
            arr[y : y + s, x : x + s] = to_u8_top(c["_val"])
        fn = f"ao_{p}.webp"
        save_grey(arr, os.path.join(OUT, fn))
        pages.append({"file": fn, "size": side})
        log(f"sayfa {fn}: {side}² ({os.path.getsize(os.path.join(OUT, fn)) / 1e6:.1f} MB)")

    # Zemin AO
    ground = None
    if GROUND_MPP > 0 and terrain is not None:
        x0 = min(c["bbox"][0] for c in results)
        z0 = min(c["bbox"][1] for c in results)
        x1 = max(c["bbox"][2] for c in results)
        z1 = max(c["bbox"][3] for c in results)
        g = ground_object(terrain, (x0, z0, x1, z1), float(exp.get("terrainDrop", 0.0)))
        isolate((x0, z0, x1, z1), OCC_MARGIN, keep=(g,))
        w = int(round((x1 - x0) / GROUND_MPP))
        h = int(round((z1 - z0) / GROUND_MPP))
        img = new_image("ground_ao", w, h, -1.0)
        t = time.time()
        do_bake(g, img, "ao" if method == "ao" else "ratio", samples)
        a = image_array(img)[..., 0]
        cov = a > -0.5
        val = np.clip(np.where(cov, a, 1.0), 0, 1)
        if DENOISE:
            b = np.zeros((h, w, 4), dtype=np.float32)
            b[..., 0] = b[..., 1] = b[..., 2] = val
            b[..., 3] = 1
            set_image(img, b)
            val = np.clip(np.where(cov, denoise(img)[..., 0], 1.0), 0, 1)
        save_grey(to_u8_top(val), os.path.join(OUT, "ground_ao.webp"))
        ground = {"file": "ground_ao.webp", "rect": [x0, z0, x1, z1], "mpp": GROUND_MPP}
        log(f"zemin AO {w}×{h} pişirme {time.time() - t:.0f}s")

    man = {
        "version": 1,
        "uvVersion": exp["uvVersion"],
        "srcHash": exp["srcHash"],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "blender": bpy.app.version_string,
        "method": "diffuse-ratio" if method == "ratio" else "ao",
        "samples": samples,
        "bounces": BOUNCES,
        "denoise": bool(DENOISE),
        "texel": exp["unwrap"]["texel"],
        "unwrap": exp["unwrap"],
        "pages": pages,
        "chunks": [
            {
                "id": c["id"],
                "bbox": c["bbox"],
                "sig": c["sig"],
                "size": c["size"],
                "texel": c["texel"],
                "page": c["page"],
                "rect": c["rect"],
                "meshes": len(c["keys"]),
            }
            for c in sorted(results, key=lambda c: c["id"])
        ],
        "groundAo": ground,
        "seconds": round(time.time() - T0),
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(man, f, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    log(f"bitti: {len(results)} parça, {len(pages)} sayfa, {total / 1e6:.1f} MB → {OUT}")


if __name__ == "__main__":
    main()
    sys.stdout.flush()
