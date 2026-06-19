import * as THREE from 'three';

// Procedural stylized fighter jet built from primitives. Returns a Group whose
// local +Z points "forward" (nose). Includes a marker for the afterburner.
export function buildJet({
  body = 0x9aa6b2,
  accent = 0x3a4654,
  cockpit = 0x10202e,
  emissive = 0x000000,
} = {}) {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: body, metalness: 0.7, roughness: 0.45, emissive, emissiveIntensity: 0.0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.6, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: cockpit, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.8, roughness: 0.4 });

  // Fuselage — tapered using a lathe-like cylinder.
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 6.2, 16), bodyMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.scale.set(1, 1, 1.0);
  g.add(fuse);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 16), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 4.2;
  g.add(nose);

  // Tail exhaust nozzle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.0, 16), darkMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -3.4;
  g.add(nozzle);

  // Cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.7), glassMat);
  canopy.scale.set(0.9, 0.7, 1.7);
  canopy.position.set(0, 0.45, 1.6);
  g.add(canopy);

  // Main wings (swept delta)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 1.2);
  wingShape.lineTo(4.6, -1.9);
  wingShape.lineTo(4.6, -2.5);
  wingShape.lineTo(0, -1.4);
  wingShape.lineTo(0, 1.2);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: false });
  wingGeo.translate(0, 0, -0.08);

  const wingL = new THREE.Mesh(wingGeo, accentMat);
  wingL.rotation.x = Math.PI / 2;
  wingL.position.set(0.4, -0.1, -0.2);
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.scale.x = -1;
  wingR.position.x = -0.4;
  g.add(wingR);

  // Horizontal stabilizers (tail wings)
  const stabShape = new THREE.Shape();
  stabShape.moveTo(0, 0.6);
  stabShape.lineTo(1.8, -0.7);
  stabShape.lineTo(1.8, -1.0);
  stabShape.lineTo(0, -0.7);
  const stabGeo = new THREE.ExtrudeGeometry(stabShape, { depth: 0.1, bevelEnabled: false });
  const stabL = new THREE.Mesh(stabGeo, accentMat);
  stabL.rotation.x = Math.PI / 2;
  stabL.position.set(0.45, 0, -3.0);
  g.add(stabL);
  const stabR = stabL.clone();
  stabR.scale.x = -1;
  stabR.position.x = -0.45;
  g.add(stabR);

  // Twin vertical tail fins (canted)
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.2, 1.5);
  finShape.lineTo(1.3, 1.5);
  finShape.lineTo(1.6, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
  const finL = new THREE.Mesh(finGeo, accentMat);
  finL.position.set(0.5, 0.2, -3.2);
  finL.rotation.y = Math.PI / 2;
  finL.rotation.z = 0.25;
  g.add(finL);
  const finR = finL.clone();
  finR.position.x = -0.5;
  finR.rotation.z = -0.25;
  finR.scale.z = -1;
  g.add(finR);

  // Wingtip missiles / detail pods
  const podGeo = new THREE.CapsuleGeometry(0.12, 1.0, 4, 8);
  for (const sx of [1, -1]) {
    const pod = new THREE.Mesh(podGeo, darkMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 4.0, -0.1, -0.4);
    g.add(pod);
  }

  // Afterburner glow marker (no mesh; effects attach here)
  const burner = new THREE.Object3D();
  burner.position.set(0, 0, -3.9);
  g.add(burner);
  g.userData.burner = burner;

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  return g;
}
