import { getAllBoatNames, getBoatTimeline } from './boatData.js';

const boatNames = getAllBoatNames();

const slider = document.querySelector('.boat-slider');
const cards = slider?.querySelectorAll('.boat-card') || [];
const prevBtn = document.querySelector('.arrows .prev');
const nextBtn = document.querySelector('.arrows .next');

let currentIndex = 0;

function showCard(index) {
  cards.forEach((card, i) => {
    card.classList.toggle('active', i === index);
    card.style.display = i === index ? 'flex' : 'none';
  });
}

function nextCard() {
  currentIndex = (currentIndex + 1) % cards.length;
  showCard(currentIndex);
}

function prevCard() {
  currentIndex = (currentIndex - 1 + cards.length) % cards.length;
  showCard(currentIndex);
}

if (prevBtn) {
  prevBtn.addEventListener('click', prevCard);
}

if (nextBtn) {
  nextBtn.addEventListener('click', nextCard);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') prevCard();
  if (e.key === 'ArrowRight') nextCard();
});

document.querySelectorAll('.choose').forEach((btn, index) => {
  btn.addEventListener('click', () => {
    const name = boatNames[index] || 'Patrol Boat';
    const price = 0; // price resolved on order page from boatData
    const selectedBoat = {
      name: name,
      price: price,
      index: index
    };
    localStorage.setItem('selectedBoat', JSON.stringify(selectedBoat));
    window.location.href = 'order.html';
  });
});

if (cards.length > 0) showCard(0);

// ---- Timeline ----
const cardBoatMap = boatNames;

cards.forEach((card, index) => {
  const boatName = cardBoatMap[index] || "Passenger Boat";
  const timeline = getBoatTimeline(boatName);
  if (!timeline) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'boat-timeline';
  wrapper.innerHTML = `
    <h3><i class="fas fa-clock"></i> Build Timeline</h3>
    <div class="timeline-duration">Total: <strong>${timeline.totalDuration}</strong></div>
    <div class="timeline-phases">
      ${timeline.phases.map((phase, i) => {
        const [name, duration] = phase.split(" - ");
        return `
          <div class="timeline-step">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <span class="timeline-phase-name">${name}</span>
              <span class="timeline-phase-dur">${duration}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  card.appendChild(wrapper);
});
