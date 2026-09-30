import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipStore, unzip, encodePngRgb, imageInfo, validateImage } from '../public/js/pack/binary.js';

const dir = mkdtempSync(join(tmpdir(), 'gpo-bin-'));
const py = (code, ...args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' }).trim();

test('crc32 bilinen değerler', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip: Python zipfile doğrular, UTF-8 adlar korunur, geri okunur', async () => {
  const files = [
    { path: 'fastlane/metadata/android/tr-TR/title.txt', data: 'Yol Kralı: Tır Simülatörü\n' },
    { path: 'bin/x.bin', data: new Uint8Array([0, 1, 2, 255]) }
  ];
  const z = zipStore(files);
  const f = join(dir, 'a.zip');
  writeFileSync(f, z);
  const out = JSON.parse(py('import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"n":z.namelist(), "t":z.read(z.namelist()[0]).decode()}))', f));
  assert.deepEqual(out.n, files.map((x) => x.path));
  assert.equal(out.t, 'Yol Kralı: Tır Simülatörü\n');
  const back = await unzip(z);
  assert.equal(new TextDecoder().decode(back[0].data), 'Yol Kralı: Tır Simülatörü\n');
  assert.deepEqual([...back[1].data], [0, 1, 2, 255]);
});

test('zip: deflate ile sıkıştırılmış (Python) arşiv okunur', async () => {
  const f = join(dir, 'd.zip');
  py('import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.writestr("publish-pack/project.json", "{\\"name\\":\\"A\\"}"*50); z.close()', f);
  const buf = execFileSync('cat', [f]);
  const e = await unzip(new Uint8Array(buf));
  assert.equal(e[0].path, 'publish-pack/project.json');
  assert.ok(new TextDecoder().decode(e[0].data).startsWith('{"name":"A"}'));
  await assert.rejects(unzip(new Uint8Array([1, 2, 3])), /ZIP/);
});

test('png: 24-bit RGB, alfa yok, piksel değerleri doğru (zlib ile çözülür)', async () => {
  const w = 3; const h = 2;
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 0, 0, 0, 0, 200, 100, 50, 128]);
  const png = await encodePngRgb(rgba, w, h, [255, 255, 255]);
  const info = imageInfo(png);
  assert.deepEqual([info.type, info.width, info.height, info.alpha, info.colorType, info.bitDepth], ['image/png', 3, 2, false, 2, 8]);
  const f = join(dir, 'p.png');
  writeFileSync(f, png);
  // Python ile bağımsız çözüm: parçaların CRC'si + Sub filtresini geri al
  const px = py(`
import sys,zlib,struct
b=open(sys.argv[1],'rb').read(); assert b[:8]==b'\\x89PNG\\r\\n\\x1a\\n'
p=8; idat=b''
while p<len(b):
  n=struct.unpack('>I',b[p:p+4])[0]; t=b[p+4:p+8]; d=b[p+8:p+8+n]
  assert zlib.crc32(t+d)&0xffffffff==struct.unpack('>I',b[p+8+n:p+12+n])[0]
  if t==b'IDAT': idat+=d
  p+=12+n
raw=zlib.decompress(idat); w,h=3,2; s=w*3+1; out=[]
for y in range(h):
  f=raw[y*s]; row=list(raw[y*s+1:(y+1)*s])
  if f==1:
    for i in range(3,len(row)): row[i]=(row[i]+row[i-3])&255
  out+=row
print(','.join(map(str,out)))`, f);
  assert.equal(px, '255,0,0,0,255,0,0,0,255,10,20,30,255,255,255,227,177,152');
});

test('görsel denetimi: Play şartları', () => {
  assert.equal(validateImage('icon', { type: 'image/png', width: 512, height: 512, alpha: true }, 2000).length, 0);
  assert.ok(validateImage('icon', { type: 'image/jpeg', width: 512, height: 512, alpha: false }, 2000).some((x) => /PNG/.test(x.msg)));
  assert.ok(validateImage('featureGraphic', { type: 'image/png', width: 1024, height: 500, alpha: true }, 2000).some((x) => /alfa/.test(x.msg)));
  assert.ok(validateImage('screenshot', { type: 'image/png', width: 1080, height: 2400, alpha: false }, 2000).some((x) => /2:1/.test(x.msg)));
  assert.deepEqual(validateImage('screenshot', { type: 'image/jpeg', width: 1920, height: 1080, alpha: false }, 2000), []);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xf4, 0x04, 0x00, 3, 1, 1, 1]);
  assert.deepEqual(imageInfo(jpeg), { type: 'image/jpeg', width: 1024, height: 500, alpha: false });
});
