"""Download pinned npm codec distributions without installing into the host project."""
import hashlib
import base64
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "web" / "vendor"
PACKAGES = [
    ("utif", "3.1.0", [("package/UTIF.js", "utif.js"), ("package/LICENSE", "utif.LICENSE")]),
    ("pako", "1.0.11", [("package/dist/pako.min.js", "pako.min.js"), ("package/LICENSE", "pako.LICENSE")]),
    ("heic2any", "0.0.4", [("package/dist/heic2any.min.js", "heic2any.min.js"), ("package/LICENSE.md", "heic2any.LICENSE.md")]),
]


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "OTools-image-tools-codec-vendor/0.1"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    provenance = []
    for name, version, files in PACKAGES:
        metadata = json.loads(fetch(f"https://registry.npmjs.org/{name}/{version}"))
        tarball = metadata["dist"]["tarball"]
        archive = fetch(tarball)
        integrity = metadata["dist"]["integrity"]
        algorithm, expected = integrity.split("-", 1)
        actual = base64.b64encode(hashlib.new(algorithm, archive).digest()).decode("ascii")
        if actual != expected:
            raise RuntimeError(f"Integrity mismatch: {name}@{version}")
        entries = []
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
            for source, target in files:
                try:
                    content = package.extractfile(source).read()
                except KeyError:
                    print(f"Missing {source}; available license entries: {[x for x in package.getnames() if 'licen' in x.lower()]}")
                    raise
                (DEST / target).write_bytes(content)
                entries.append({"file": target, "sha256": hashlib.sha256(content).hexdigest()})
                print(f"{name}@{version}: {target} {len(content)} bytes")
        provenance.append({"name": name, "version": version, "license": metadata.get("license"), "tarball": tarball, "integrity": integrity, "files": entries})
    (DEST / "codecs.json").write_bytes((json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
