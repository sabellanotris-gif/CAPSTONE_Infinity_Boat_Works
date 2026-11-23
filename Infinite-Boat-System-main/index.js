const carousel = document.querySelector('.carousel .list');
const items = carousel.querySelectorAll('.item');
const prevBtn = document.querySelector('.arrows .prev');
const nextBtn = document.querySelector('.arrows .next');
const dots = Array.from(document.querySelectorAll('.arrows .indicators .dot'));

let currentIndex = 0;
let autoSlideInterval;

function showSlide(index) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === index);
    item.style.opacity = i === index ? '1' : '0';
    item.style.zIndex = i === index ? '1' : '0';
  });

  dots.forEach((dot, i) => {
    if (i === index) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });
}

function nextSlide() {
  currentIndex = (currentIndex + 1) % items.length;
  showSlide(currentIndex);
}

function prevSlide() {
  currentIndex = (currentIndex - 1 + items.length) % items.length;
  showSlide(currentIndex);
}

function startAutoSlide() {
  stopAutoSlide();
  autoSlideInterval = setInterval(nextSlide, 5000);
}

function stopAutoSlide() {
  if (autoSlideInterval) {
    clearInterval(autoSlideInterval);
    autoSlideInterval = null;
  }
}

prevBtn.addEventListener('click', () => {
  prevSlide();
  startAutoSlide();
});

nextBtn.addEventListener('click', () => {
  nextSlide();
  startAutoSlide();
});

dots.forEach((dot, i) => {
  dot.addEventListener('click', () => {
    currentIndex = i;
    showSlide(currentIndex);
    startAutoSlide();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { prevSlide(); startAutoSlide(); }
  if (e.key === 'ArrowRight') { nextSlide(); startAutoSlide(); }
});

showSlide(0);
startAutoSlide();

// ---- Sticky header background on scroll ----
const siteHeader = document.querySelector('header');

function updateHeaderState() {
  if (!siteHeader) return;
  siteHeader.classList.toggle('scrolled', window.scrollY > 24);
}

updateHeaderState();
window.addEventListener('scroll', updateHeaderState, { passive: true });

// ---- Mobile quick-link menu ----
const navbar = document.querySelector('.navbar');
const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.getElementById('primaryMenu');

function closeNav() {
  if (!navbar || !navToggle) return;
  navbar.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-label', 'Open menu');
  const icon = navToggle.querySelector('i');
  if (icon) icon.className = 'fa-solid fa-bars';
}

if (navbar && navToggle) {
  navToggle.addEventListener('click', () => {
    const open = navbar.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    const icon = navToggle.querySelector('i');
    if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  });

  if (navMenu) {
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeNav);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });

  document.addEventListener('click', (e) => {
    if (!navbar.contains(e.target)) closeNav();
  });
}
