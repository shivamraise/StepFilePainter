# Mapping tests

Both scripts read the mapping code out of `../index.html` directly, so they test the
shipped app rather than a copy. They need the same OCCT build the page loads:

```sh
cd test
npm install
```

## roundtrip.cjs

Paints every face a unique colour, exports, re-reads the export through
occt-import-js, and asserts each colour comes back on the same geometry.

```sh
node roundtrip.cjs ../index.html <file.step> [...]
```

Checks: face counts line up, every mapped face is geometrically the right face,
the export still parses, geometry is unchanged, topology survives the round-trip,
every painted colour returns on the same face, and re-export does not grow the file.

## verifycheck.cjs

Exercises the safety net in `verifyStepMapping()`: the correct mapping must be
accepted, and a shuffled one must be rejected. This is the guard that stops a
mis-ordered file from silently colouring the wrong faces.

```sh
node verifycheck.cjs ../index.html <file.step> [...]
```

## Notes

Files whose tessellation does not line up with the parsed topology — deep assemblies
that instance sub-assemblies, for instance — are expected to be *refused*, not mapped.
`verifycheck.cjs` reports that as a pass.
