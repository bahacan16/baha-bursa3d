import * as THREE from 'three';

/**
 * Ultra gerçekçilik paketi (yalnız güçlü masaüstü GPU). KARAR (kullanıcı): "mobilden açılmayacak kadar ağır olsun".
 * Düşük/Orta/Yüksek bu dosyadaki hiçbir şeyi kullanmaz: gölgelendirici parçaları yalnız `installUltraChunks()`
 * çağrılınca (Game kurulurken, Ultra açıksa) değiştirilir.
 *
 * - Güneş: three'nin SunLight'ı (2 kademeli CSM, 4096² kademe başına) + PCSS (gerçek güneş açısı → gölge ucunda
 *   yumuşayan, temas noktasında keskin yarı gölge), alıcı düzlemi derinlik eğimi (acne yok, küçük normal ofseti →
 *   peter-panning yok).
 * - Bulut gölgeleri: gökyüzündeki bulut alanının (sky.ts, aynı fbm) güneş yönünde yere düşen izdüşümü, yavaş kayar.
 * - Hava perspektifi: yükseklikle azalan üstel pus (analitik), mesafe = gerçek uzaklık (derinlik değil).
 */
export const ultraState = {
  on: false,
  /** Bulut örtüsü 0..1 (gökyüzü ve yer gölgesi aynı alanı kullanır). */
  cloudCover: 0.32,
  /** Bulut tabakası yüksekliği (m) ve yatay ölçek (m / gürültü hücresi). */
  cloudHeight: 1600,
  cloudScale: 2600,
  /** Rüzgâr (m/s, x/z) — bulutlar ve gölgeleri yavaşça kayar. */
  wind: new THREE.Vector2(6, 2.5),
  /** Pus sönüm katsayısı (1/m, yerde) ve ölçek yüksekliği (m). */
  hazeDensity: 0.00021,
  hazeHeight: 1100,
};

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
if (q.has('clouds')) ultraState.cloudCover = Number(q.get('clouds'));
if (q.has('haze')) ultraState.hazeDensity = Number(q.get('haze'));

/** Güneşin etkin açısal çapı (rad). Gerçek disk 0.53°; hale (aureole) + atmosfer saçılımıyla fotoğraftaki gölge
 * kenarı daha yumuşak görünür → ~1.1° (Street View ağaç gölgelerinden göz kararı; ?pcss= ile denenebilir). */
const SUN_DIAM = (Number(q.get('pcss') ?? 1.1) * Math.PI) / 180;

/** Yazılım işleyici (SwiftShader/llvmpipe) veya tümleşik/mobil GPU → Ultra kendiliğinden açılmaz. */
export function weakGpu(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|softpipe|microsoft basic|intel|mali|adreno|powervr|radeon\(tm\) graphics|vega \d+ graphics/i.test(
      name,
    );
  } catch {
    return false;
  }
}

/** Bulut yoğunluk alanı: Sky gölgelendiricisindeki gradyan gürültü + fbm'nin aynısı (dünya düzleminde). */
export const CLOUD_GLSL = /* glsl */ `
vec2 ucGrad( vec2 i ) {
  vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0;
}
float ucNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( ucGrad( i ), f );
  float b = dot( ucGrad( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( ucGrad( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( ucGrad( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6;
}
float ucFbm( vec2 p, float drift ) {
  float r = 0.0;
  float a = 1.0;
  for ( int i = 0; i < 4; i ++ ) { r += a * ucNoise( p ); a *= 0.5; p = p * 2.0 + drift; }
  return r;
}
// Bulut düzlemindeki (dünya xz, m) nokta → (yoğunluk derinliği, eşik); t = saniye
vec2 ucField( vec2 xz, float t, float cover ) {
  vec2 p = ( xz - vec2( ${ultraState.wind.x.toFixed(3)}, ${ultraState.wind.y.toFixed(3)} ) * t ) / ${ultraState.cloudScale.toFixed(1)};
  float n = clamp( ucFbm( p, t * 0.00035 ) * 0.7 + 0.5, 0.0, 1.0 );
  float region = ucNoise( p * 0.3 ) * 0.37 + 0.5;
  float cov = clamp( cover + ( region - 0.5 ) * 0.6, 0.0, 1.0 );
  float th = 1.0 - cov;
  return vec2( n, th );
}
`;

const PCSS_GLSL = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
${CLOUD_GLSL}
float ultraIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
vec2 ultraVogel( int i, int n, float phi ) {
  float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
  float th = float( i ) * 2.399963229728653 + phi;
  return vec2( cos( th ), sin( th ) ) * r;
}
// Güneş yönünde bulut tabakasına çıkıp bulut yoğunluğundan geçirgenlik
float ultraCloudShadow( vec3 wp, vec3 toSun, float t, float cover ) {
  if ( cover <= 0.0 || toSun.y < 0.05 ) return 1.0;
  vec2 xz = wp.xz + toSun.xz * ( ${ultraState.cloudHeight.toFixed(1)} - wp.y ) / toSun.y;
  vec2 f = ucField( xz, t, cover );
  float depth = max( 0.0, f.x - f.y );
  float alpha = 1.0 - exp( - depth * 0.4 * 12.0 );
  return 1.0 - 0.82 * alpha;
}
// PCSS: blocker araması → yarı gölge genişliği (güneş açısı × engel–alıcı mesafesi) → Vogel diski PCF.
// Derinlik eğimi alıcı düzleminden (ekran türevleri) → geniş çekirdekte acne yok.
float ultraPCSS( sampler2D sm, vec2 smSize, mat4 M, int tile, vec3 wp, vec3 nrm, vec3 dwx, vec3 dwy, float phi ) {
  float uvPerM = length( vec3( M[0][0], M[1][0], M[2][0] ) );
  vec3 zRow = vec3( M[0][2], M[1][2], M[2][2] );
  float zPerM = length( zRow );
  float texM = 1.0 / max( uvPerM * smSize.x, 1e-6 );
  vec3 L = zRow / max( zPerM, 1e-9 );
  float cosT = clamp( abs( dot( nrm, L ) ), 0.05, 1.0 );
  // normal ofseti ≈ 1 texel (kademe ölçeğine göre); eğik yüzeyde biraz fazla
  vec3 p = wp + nrm * texM * ( 0.8 + 0.8 * ( 1.0 - cosT ) );
  vec4 sc = M * vec4( p, 1.0 );
  vec2 tmin = vec2( float( tile ) * 0.5, 0.0 ) + 1.5 / smSize;
  vec2 tmax = vec2( float( tile ) * 0.5 + 0.5, 1.0 ) - 1.5 / smSize;
  if ( sc.x < tmin.x || sc.x > tmax.x || sc.y < tmin.y || sc.y > tmax.y || sc.z > 1.0 ) return 1.0;
  // alıcı düzlemi: dz/duv
  vec3 dx = ( M * vec4( dwx, 0.0 ) ).xyz;
  vec3 dy = ( M * vec4( dwy, 0.0 ) ).xyz;
  mat2 A = mat2( dx.x, dy.x, dx.y, dy.y );
  float det = determinant( A );
  vec2 g = abs( det ) > 1e-14 ? inverse( A ) * vec2( dx.z, dy.z ) : vec2( 0.0 );
  vec2 texel = 1.0 / smSize;
  // |g|·uv sınırı: siluet kenarında türevler patlar
  float gmax = zPerM * texM * 6.0 / texel.y;
  if ( length( g ) > gmax ) g = normalize( g ) * gmax;
  float eps = zPerM * texM * 0.6 + 0.00002;
  float zR = sc.z;
  const int NB = 12;
  const int NF = 20;
  float searchT = 22.0;
  float sumB = 0.0;
  float nB = 0.0;
  for ( int i = 0; i < NB; i ++ ) {
    vec2 o = ultraVogel( i, NB, phi ) * searchT * texel;
    float d = texture2D( sm, clamp( sc.xy + o, tmin, tmax ) ).r;
    float zr = zR + dot( g, o );
    if ( d < zr - eps ) { sumB += d; nB += 1.0; }
  }
  if ( nB < 0.5 ) return 1.0;
  float zB = sumB / nB;
  float penM = max( zR - zB, 0.0 ) / zPerM * ${Math.tan(SUN_DIAM).toFixed(6)};
  float rT = clamp( 0.5 * penM / texM, 1.0, 22.0 );
  float lit = 0.0;
  for ( int i = 0; i < NF; i ++ ) {
    vec2 o = ultraVogel( i, NF, phi + 1.3 ) * rT * texel;
    float d = texture2D( sm, clamp( sc.xy + o, tmin, tmax ) ).r;
    float zr = zR + dot( g, o );
    lit += step( zr - eps, d );
  }
  return lit / float( NF );
}
float getSunShadowUltra( sampler2D shadowMap, SunLightShadow sls, int shadowIndex ) {
  vec3 wp = vSunShadowWorldPosition.xyz;
  vec3 nrm = normalize( vSunShadowWorldNormal );
  vec3 dwx = dFdx( wp );
  vec3 dwy = dFdy( wp );
  float viewDepth = vSunShadowWorldPosition.w;
  int off = shadowIndex * SUN_LIGHT_CASCADES;
  float t = sunShadowCascade[ off ].w;
  float cover = sunShadowCascade[ off + 1 ].w;
  // kare başına döndürülen örnek deseni → TAA ile birikip pürüzsüz yarı gölge
  float phi = ( ultraIGN( gl_FragCoord.xy ) + fract( t * 7.3137 ) ) * PI2;
  float shadow = 1.0;
  for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
    vec4 c = sunShadowCascade[ off + i ];
    if ( viewDepth >= c.x && viewDepth < c.y ) {
      float cs = ultraPCSS( shadowMap, sls.shadowMapSize, sunShadowMatrix[ off + i ], i, wp, nrm, dwx, dwy, phi );
      shadow = mix( cs, shadow, smoothstep( c.z, c.y, viewDepth ) );
    }
  }
  shadow = mix( 1.0, shadow, sls.shadowIntensity );
  mat4 M0 = sunShadowMatrix[ off ];
  vec3 toSun = - normalize( vec3( M0[0][2], M0[1][2], M0[2][2] ) );
  return shadow * ultraCloudShadow( wp, toSun, t, cover );
}
#endif
`;

let installed = false;

/** Ultra gölgelendirici parçalarını kur (bir kez, ilk derlemeden önce). */
export function installUltraChunks(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  // PCSS + bulut gölgesi: güneş gölgesi fonksiyonunu değiştir (orijinali derlenir ama kullanılmaz)
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment + PCSS_GLSL;
  const lf = C.lights_fragment_begin;
  const call = 'getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX )';
  if (!lf.includes(call)) console.warn('[ultra] lights_fragment_begin: güneş gölgesi çağrısı bulunamadı');
  C.lights_fragment_begin = lf.replace(call, call.replace('getSunShadow', 'getSunShadowUltra'));
  const sm = C.shadowmask_pars_fragment;
  C.shadowmask_pars_fragment = sm.replace(
    'getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX )',
    'getSunShadowUltra( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX )',
  );
  // Hava perspektifi: fogNear = sönüm katsayısı (1/m), fogFar = ölçek yüksekliği (m) (Ultra'da Fog böyle kurulur)
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vHazeY;\n#endif\n';
  C.fog_vertex =
    '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n' +
    '\tvHazeY = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y;\n#endif\n';
  C.fog_pars_fragment =
    '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying float vHazeY;\n' +
    '\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif\n';
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // analitik üstel yükseklik pusu: sigma(h) = fogNear * exp(-h / fogFar)
    float hk = ( vHazeY - cameraPosition.y ) / fogFar;
    float hf = abs( hk ) > 1e-3 ? ( 1.0 - exp( - hk ) ) / hk : 1.0;
    float od = fogNear * vFogDepth * exp( - max( cameraPosition.y, 0.0 ) / fogFar ) * hf;
    float fogFactor = 1.0 - exp( - od );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

/**
 * Sky gölgelendiricisinin bulutlarını dünya düzlemine taşı (kamera paralaksı + yer gölgesiyle aynı alan).
 * Döner: başarı.
 */
export function patchSkyClouds(mat: THREE.ShaderMaterial): boolean {
  let fs = mat.fragmentShader;
  const a = 'vec2 cloudUV = direction.xz / ( direction.y * elevation );';
  const b = 'cloudUV *= cloudScale;';
  const c = 'cloudUV += time * cloudSpeed;';
  const d = 'float cloudNoise = clamp( fbm( cloudUV * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );';
  const e = 'float region = noise( cloudUV * 300.0 ) * 0.37 + 0.5;';
  if (![a, b, c, d, e].every((s) => fs.includes(s))) {
    console.warn('[ultra] Sky bulut kodu beklenen biçimde değil; bulutlar dünya düzlemine taşınmadı');
    return false;
  }
  const H = ultraState.cloudHeight.toFixed(1);
  fs = fs
    .replace(
      a,
      `vec2 cloudXZ = cameraPosition.xz + direction.xz * ( ${H} - cameraPosition.y ) / max( direction.y, 0.012 );
				vec2 ucf = ucField( cloudXZ, time, cloudCoverage );
				vec2 cloudUV = vec2( 0.0 );`,
    )
    .replace(b, '')
    .replace(c, '')
    .replace(d, 'float cloudNoise = ucf.x;')
    .replace(e, 'float region = 0.5;')
    // örtü ucField içinde uygulandı: eşik = ucf.y
    .replace(
      'float cov = clamp( cloudCoverage + ( region - 0.5 ) * 0.6, 0.0, 1.0 );',
      'float cov = 1.0 - ucf.y;',
    )
    .replace('void main() {', `${CLOUD_GLSL}\n\t\tvoid main() {`);
  mat.fragmentShader = fs;
  mat.needsUpdate = true;
  return true;
}

/**
 * Yerel yansıma küresi (probe.ts) paylaşılan uniform'ları. Hazır olana kadar sahnenin kalibre gökyüzü ortam haritası
 * ve ölçeği kullanılır (görünüm değişmez); hazır olunca PMREM'lenmiş yerel küre + fiziksel yoğunluk.
 */
export const probeUniforms = {
  uProbe: { value: null as THREE.Texture | null },
  uProbeI: { value: 0.038 },
  uProbeReady: { value: 0 },
};

/** Cam yansıması için yerel küre haritasını alan malzemeler (Ultra'da facadeMats/araç camları kaydeder). */
export const reflectiveMaterials = new Set<THREE.Material>();

const PROBE_PARS = /* glsl */ `
uniform sampler2D uProbe;
uniform float uProbeI;
vec3 probeRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
  #ifdef ENVMAP_TYPE_CUBE_UV
    vec3 reflectVec = reflect( - viewDir, normal );
    reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
    reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
    return textureCubeUV( uProbe, reflectVec, roughness ).rgb * uProbeI;
  #else
    return vec3( 0.0 );
  #endif
}
`;

/**
 * Ultra: malzemenin aynasal ortam yansımasını (yayınık değil) yerel küreden al. Mevcut onBeforeCompile zincirlenir.
 * Yayınık ortam ışığı kalibre gökyüzü haritasında kalır (sıva/oda renkleri değişmez).
 */
export function registerReflective(m: THREE.Material): void {
  if (!ultraState.on || reflectiveMaterials.has(m)) return;
  reflectiveMaterials.add(m);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    Object.assign(sh.uniforms, probeUniforms);
    const C = THREE.ShaderChunk as unknown as Record<string, string>;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <envmap_physical_pars_fragment>',
        `#include <envmap_physical_pars_fragment>\n${PROBE_PARS}`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        C.lights_fragment_maps.replaceAll('getIBLRadiance(', 'probeRadiance('),
      );
  };
  m.customProgramCacheKey = function () {
    return prevKey.call(this) + '|ultraProbe';
  };
  m.needsUpdate = true;
}

/** Arazi yüksekliği dokusu (cephe kirlenmesi: zemine yakın sıçrama bandı için yerel zemin kotu). */
export const ultraGround = {
  uUGround: { value: null as THREE.DataTexture | null },
  uUGroundRect: { value: new THREE.Vector4(0, 0, 1, 0) },
};

export function setUltraGround(g: { n: number; half: number; cell: number; h: Float32Array }): void {
  if (!ultraState.on) return;
  const t = new THREE.DataTexture(g.h, g.n, g.n, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  ultraGround.uUGround.value = t;
  // x0, z0, boyut (m), etkin
  ultraGround.uUGroundRect.value.set(-g.half, -g.half, (g.n - 1) * g.cell, 1);
}

const WEATHER = q.get('weather') !== '0';

/**
 * Cephe yıpranması (Ultra, sıva malzemeleri): Street View'da beyaz/açık sıvaların alt 0.5–1 m'si yağmur sıçramasıyla
 * grileşmiş, düşey yüzeylerde çok hafif düşey yağmur izi lekeleri var. Görülmeyen ayrıntı uydurulmaz: yalnız bu iki
 * genel desen, düşük genlikle (ortalama renk kaymasını ~%1'de tutar, kalibre renkler korunur). ?weather=0 kapatır.
 */
export function ultraWeather(m: THREE.Material, amount = 1): void {
  if (!ultraState.on || !WEATHER) return;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    Object.assign(sh.uniforms, ultraGround);
    sh.uniforms.uWeatherAmt = { value: amount };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUWPos;\nvarying vec3 vUWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 uwp = vec4( transformed, 1.0 );
  vec3 uwn = objectNormal;
  #ifdef USE_INSTANCING
    uwp = instanceMatrix * uwp;
    uwn = mat3( instanceMatrix ) * uwn;
  #endif
  vUWPos = ( modelMatrix * uwp ).xyz;
  vUWNrm = normalize( mat3( modelMatrix ) * uwn );
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vUWPos;
varying vec3 vUWNrm;
uniform sampler2D uUGround;
uniform vec4 uUGroundRect;
uniform float uWeatherAmt;
float uwHash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float uwNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( uwHash( i ), uwHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( uwHash( i + vec2( 0.0, 1.0 ) ), uwHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 wn = normalize( vUWNrm );
  float vert = 1.0 - smoothstep( 0.35, 0.7, abs( wn.y ) );
  float g0 = 0.0;
  if ( uUGroundRect.w > 0.5 ) g0 = texture2D( uUGround, ( vUWPos.xz - uUGroundRect.xy ) / uUGroundRect.z ).r;
  float hG = vUWPos.y - g0;
  // duvar boyunca yatay koordinat
  vec2 tg = normalize( vec2( -wn.z, wn.x ) + 1e-5 );
  float u = dot( vUWPos.xz, tg );
  // sıçrama bandı: ~0.6 m, düzensiz üst kenar
  float edge = 0.45 + 0.35 * uwNoise( vec2( u * 1.7, 3.1 ) ) + 0.15 * uwNoise( vec2( u * 6.0, 7.7 ) );
  float splash = ( 1.0 - smoothstep( edge * 0.4, edge, hG ) ) * step( -0.3, hG );
  // düşey yağmur izleri: dar, uzun, seyrek; yükseklikle zayıf değişen
  float st = smoothstep( 0.62, 0.95, uwNoise( vec2( u * 2.2, vUWPos.y * 0.09 ) ) ) * uwNoise( vec2( u * 0.35, vUWPos.y * 0.03 + 11.0 ) );
  float dirt = vert * uWeatherAmt * ( splash * 0.11 + st * 0.05 );
  // kir hafif sıcak gri (toz), tamamen siyah değil
  diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.80, 0.78, 0.75 ), clamp( dirt * 5.0, 0.0, 1.0 ) );
}`,
      );
  };
  m.customProgramCacheKey = function () {
    return prevKey.call(this) + `|ultraWeather${amount}`;
  };
}
