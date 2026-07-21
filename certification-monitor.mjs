import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const OFFICIAL_SECURITY_PLUS_URL =
  'https://www.comptia.org/en-us/certifications/security/';

function unique(values) {
  return [...new Set(values)];
}

export function extractOfficialSnapshot(html) {
  if (typeof html !== 'string' || !/Security\s*\+/i.test(html)) {
    throw new Error('A página obtida não parece ser a página oficial Security+.');
  }
  const observedExamCodes = unique(
    [...html.matchAll(/\bSY0-(\d{3})\b/gi)].map((match) => `SY0-${match[1]}`),
  ).sort((left, right) => Number(left.slice(4)) - Number(right.slice(4)));
  if (!observedExamCodes.length) {
    throw new Error('Não foi possível identificar qualquer código SY0 na página oficial.');
  }

  const latestExamCode = observedExamCodes.at(-1);
  const numericCode = latestExamCode.slice(4);
  const derivedVersion = Number(numericCode[0]);

  return {
    latestExamCode,
    // CompTIA's Security+ generation is encoded in the hundreds digit:
    // SY0-701 -> V7, SY0-801 -> V8. This avoids pairing a newly announced
    // code with an older V label elsewhere on the same transition page.
    latestExamVersion: `V${derivedVersion}`,
    observedExamCodes,
  };
}

export function buildCertificationManifest(html, previous, now = new Date()) {
  const snapshot = extractOfficialSnapshot(html);
  const courseExamCode = previous.courseExamCode ?? 'SY0-701';
  const courseExamVersion = previous.courseExamVersion ?? 'V7';
  const contentUpdateRequired =
    snapshot.latestExamCode !== courseExamCode ||
    snapshot.latestExamVersion !== courseExamVersion;
  return {
    schemaVersion: 1,
    certificationId: 'comptia-security-plus',
    ...snapshot,
    courseExamCode,
    courseExamVersion,
    status: contentUpdateRequired ? 'transition' : 'active',
    contentUpdateRequired,
    lastOfficialCheck: now.toISOString(),
    sourceUrl: OFFICIAL_SECURITY_PLUS_URL,
    messagePt: contentUpdateRequired
      ? `Foi observada a versão ${snapshot.latestExamCode} (${snapshot.latestExamVersion}); o curso ainda está alinhado com ${courseExamCode} (${courseExamVersion}).`
      : `A versão oficial observada continua a ser a ${snapshot.latestExamCode} (${snapshot.latestExamVersion}).`,
  };
}

function argumentValue(name) {
  const position = process.argv.indexOf(name);
  return position >= 0 ? process.argv[position + 1] : undefined;
}

async function runCli() {
  const outputPath = argumentValue('--write');
  if (!outputPath) {
    throw new Error('Uso: node certification-monitor.mjs --write <manifest.json> [--html fixture.html]');
  }
  const previous = JSON.parse(await readFile(outputPath, 'utf8'));
  const fixturePath = argumentValue('--html');
  const html = fixturePath
    ? await readFile(fixturePath, 'utf8')
    : await fetch(OFFICIAL_SECURITY_PLUS_URL, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'SecurityPlus-Master-Certification-Monitor/1.0',
        },
      }).then((response) => {
        if (!response.ok) throw new Error(`CompTIA respondeu HTTP ${response.status}.`);
        return response.text();
      });
  const next = buildCertificationManifest(html, previous);
  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(
    `Certification status: ${next.latestExamCode} ${next.latestExamVersion}; update=${next.contentUpdateRequired}`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
