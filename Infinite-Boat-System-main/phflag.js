/**
 * Shared Philippine flag renderer. Draws the flag onto a canvas 2D context
 * so the SAME drawing can be used for the HTML preview thumbnail and for
 * the 3D decal texture in the viewer — no image asset required.
 *
 * Proportions: 2:1 (width:height). White equilateral triangle at the hoist,
 * golden-yellow sun with 8 primary rays, and one five-pointed star at each
 * corner of the triangle.
 */
export function drawPhilippineFlag(ctx, w, h) {
  const BLUE = '#0038A8';
  const RED = '#CE1126';
  const WHITE = '#FFFFFF';
  const GOLD = '#FCD116';

  ctx.clearRect(0, 0, w, h);

  // Horizontal bands (upper blue, lower red)
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, w, h / 2);
  ctx.fillStyle = RED;
  ctx.fillRect(0, h / 2, w, h / 2);

  // White equilateral triangle, base along the hoist (left edge)
  const apexX = (h * Math.sqrt(3)) / 2;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(apexX, h / 2);
  ctx.closePath();
  ctx.fill();

  const sunX = apexX * 0.4;
  const sunY = h / 2;
  const sunR = h * 0.085;

  // Sun with 8 primary rays
  ctx.fillStyle = GOLD;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const inner = sunR * 0.95;
    const outer = sunR * 1.75;
    const halfWidth = sunR * 0.22;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    const px = Math.cos(angle + Math.PI / 2);
    const py = Math.sin(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(sunX + cx * inner + px * halfWidth, sunY + cy * inner + py * halfWidth);
    ctx.lineTo(sunX + cx * outer, sunY + cy * outer);
    ctx.lineTo(sunX + cx * inner - px * halfWidth, sunY + cy * inner - py * halfWidth);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Three five-pointed stars at the triangle corners
  const star = (cx, cy, r) => {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.382;
      const x = cx + Math.cos(angle) * rad;
      const y = cy + Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  const starR = h * 0.075;
  const inset = h * 0.115;
  star(inset, inset, starR);                    // top-left corner
  star(inset, h - inset, starR);               // bottom-left corner
  star(apexX * 0.86, h / 2, starR);            // apex corner
}
