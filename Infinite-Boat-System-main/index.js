const carousel = document.querySelector('.carousel .list');
const items = carousel.querySelectorAll('.item');
const prevBtn = document.querySelector('.arrows .prev');
const nextBtn = document.querySelector('.arrows .next');

let currentIndex = 0;
let autoSlideInterval;

function showSlide(index) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === index);
    item.style.opacity = i === index ? '1' : '0';
    item.style.zIndex = i === index ? '1' : '0';
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { prevSlide(); startAutoSlide(); }
  if (e.key === 'ArrowRight') { nextSlide(); startAutoSlide(); }
});

showSlide(0);
startAutoSlide();
