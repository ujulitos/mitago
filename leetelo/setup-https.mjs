import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certsDir = path.join(__dirname, 'certs');

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    'D:\\Documentos\\crec\\LMS\\laragon\\bin\\apache\\httpd-2.4.62-240904-win64-VS17\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['version'], { stdio: 'ignore' });
      return bin;
    } catch {}
  }
  throw new Error('No se encontró openssl. Instala OpenSSL o Git for Windows e inténtalo de nuevo.');
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const iface of Object.keys(nets)) {
    for (const net of nets[iface] || []) {
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
        list.push({ iface, address: net.address });
      }
    }
  }
  const rank = ({ iface, address }) => {
    if (/wi-?fi|wlan/i.test(iface)) return 0;
    if (/ethernet/i.test(iface) && address.startsWith('192.168.')) return 1;
    if (address.startsWith('192.168.')) return 2;
    return 3;
  };
  list.sort((a, b) => rank(a) - rank(b));
  return [...new Set(list.map((x) => x.address))];
}

const openssl = findOpenSsl();
fs.mkdirSync(certsDir, { recursive: true });

const rootKey = path.join(certsDir, 'rootCA.key');
const rootCert = path.join(certsDir, 'rootCA.crt');
const serverKey = path.join(certsDir, 'key.pem');
const serverCert = path.join(certsDir, 'cert.pem');
const serverCsr = path.join(certsDir, 'server.csr');
const caConf = path.join(certsDir, 'ca.cnf');
const serverConf = path.join(certsDir, 'server.cnf');
const extConf = path.join(certsDir, 'ext.cnf');
const srlFile = path.join(certsDir, 'rootCA.srl');

const extraIps = process.argv.slice(2).filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
const ips = [...new Set([...getLanIps(), ...extraIps, '127.0.0.1'])];
const dnsNames = [...new Set(['localhost', os.hostname()].filter(Boolean))];
const primaryIp = ips[0] || '127.0.0.1';

if (!fs.existsSync(rootKey) || !fs.existsSync(rootCert)) {
  fs.writeFileSync(caConf, `[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = Leetelo Local WiFi CA
O = Leetelo

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
`);
  execFileSync(openssl, ['genrsa', '-out', rootKey, '2048'], { stdio: 'inherit' });
  execFileSync(openssl, [
    'req', '-x509', '-new', '-nodes',
    '-key', rootKey,
    '-sha256', '-days', '3650',
    '-out', rootCert,
    '-config', caConf,
  ], { stdio: 'inherit' });
  console.log('✓ CA raíz local creada:', rootCert);
} else {
  console.log('✓ Reutilizando CA raíz existente:', rootCert);
}

const sanEntries = [
  ...dnsNames.map((d, i) => `DNS.${i + 1} = ${d}`),
  ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`),
].join('\n');

fs.writeFileSync(serverConf, `[req]
distinguished_name = dn
prompt = no

[dn]
CN = ${primaryIp}
O = Leetelo
`);

fs.writeFileSync(extConf, `authorityKeyIdentifier = keyid,issuer
basicConstraints = CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${sanEntries}
`);

execFileSync(openssl, ['genrsa', '-out', serverKey, '2048'], { stdio: 'inherit' });
execFileSync(openssl, [
  'req', '-new',
  '-key', serverKey,
  '-out', serverCsr,
  '-config', serverConf,
], { stdio: 'inherit' });
execFileSync(openssl, [
  'x509', '-req',
  '-in', serverCsr,
  '-CA', rootCert,
  '-CAkey', rootKey,
  '-CAcreateserial',
  '-out', serverCert,
  '-days', '825',
  '-sha256',
  '-extfile', extConf,
], { stdio: 'inherit' });

for (const tmp of [caConf, serverConf, extConf, serverCsr, srlFile]) {
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
}

console.log('\n✓ Certificado HTTPS del servidor generado para:');
for (const ip of ips) console.log(`  - IP:  ${ip}`);
for (const d of dnsNames) console.log(`  - DNS: ${d}`);
console.log(`\nSiguiente paso en tu teléfono (una sola vez):`);
console.log(`  1. Ejecuta abrir-server.bat (o node server.js).`);
console.log(`  2. En el navegador de tu teléfono abre: http://${primaryIp}:3001`);
console.log(`     y toca "Descargar Certificado" para instalar y confiar en leetelo-rootCA.crt.`);
console.log(`  3. En la webapp (Sincronizar desde PC) usa: https://${primaryIp}:3000\n`);
