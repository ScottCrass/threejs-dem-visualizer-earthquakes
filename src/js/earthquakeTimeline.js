/**
 * Creates a timeline UI for earthquake playback
 */
export function createEarthquakeTimeline(earthquakeOverlay, terrainBounds) {
  const container = document.createElement('div');
  container.className = 'earthquake-timeline';
  container.style.position = 'absolute';
  container.style.bottom = '10px';
  container.style.left = '10px';
  container.style.right = '10px';
  container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  container.style.padding = '10px';
  container.style.borderRadius = '5px';
  container.style.zIndex = '1000';
  container.style.color = 'white';
  container.style.fontFamily = 'Futura, Futura PT, Trebuchet MS, sans-serif';
  container.style.display = 'none'; // Initially hidden until earthquakes are loaded
  
  // Create timeline slider
  const sliderContainer = document.createElement('div');
  sliderContainer.style.display = 'flex';
  sliderContainer.style.alignItems = 'center';
  sliderContainer.style.gap = '10px';
  sliderContainer.style.marginBottom = '5px';
  
  const timeLabel = document.createElement('div');
  timeLabel.textContent = 'Time:';
  timeLabel.style.width = '40px';
  
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '0';
  slider.style.flex = '1';
  slider.style.height = '20px';
  slider.style.cursor = 'pointer';
  
  const currentTimeDisplay = document.createElement('div');
  currentTimeDisplay.textContent = 'N/A';
  currentTimeDisplay.style.width = '180px';
  currentTimeDisplay.style.textAlign = 'right';
  
  sliderContainer.appendChild(timeLabel);
  sliderContainer.appendChild(slider);
  sliderContainer.appendChild(currentTimeDisplay);
  
  // Create playback controls
  const controlsContainer = document.createElement('div');
  controlsContainer.style.display = 'flex';
  controlsContainer.style.alignItems = 'center';
  controlsContainer.style.gap = '10px';
  
  const playButton = document.createElement('button');
  playButton.textContent = '▶ Play';
  playButton.style.padding = '5px 10px';
  playButton.style.cursor = 'pointer';
  
  const pauseButton = document.createElement('button');
  pauseButton.textContent = '⏸ Pause';
  pauseButton.style.padding = '5px 10px';
  pauseButton.style.cursor = 'pointer';
  
  const stopButton = document.createElement('button');
  stopButton.textContent = '⏹ Stop';
  stopButton.style.padding = '5px 10px';
  stopButton.style.cursor = 'pointer';
  
  const speedLabel = document.createElement('div');
  speedLabel.textContent = 'Speed:';
  
  const speedSelect = document.createElement('select');
  speedSelect.style.padding = '5px';
  speedSelect.style.cursor = 'pointer';
  
  // Add speed options (days per second)
  const speedOptions = [
    { value: 0.1, label: '0.1x (0.1 days/sec)' },
    { value: 0.5, label: '0.5x (0.5 days/sec)' },
    { value: 1, label: '1x (1 day/sec)' },
    { value: 2, label: '2x (2 days/sec)' },
    { value: 5, label: '5x (5 days/sec)' },
    { value: 10, label: '10x (10 days/sec)' }
  ];
  
  speedOptions.forEach(option => {
    const optElement = document.createElement('option');
    optElement.value = option.value;
    optElement.textContent = option.label;
    speedSelect.appendChild(optElement);
  });
  
  speedSelect.value = '1'; // Default speed
  
  const dateRangeDisplay = document.createElement('div');
  dateRangeDisplay.style.marginLeft = 'auto';
  dateRangeDisplay.style.textAlign = 'right';
  dateRangeDisplay.textContent = 'Range: N/A';
  
  controlsContainer.appendChild(playButton);
  controlsContainer.appendChild(pauseButton);
  controlsContainer.appendChild(stopButton);
  controlsContainer.appendChild(speedLabel);
  controlsContainer.appendChild(speedSelect);
  controlsContainer.appendChild(dateRangeDisplay);
  
  // Add everything to the container
  container.appendChild(sliderContainer);
  container.appendChild(controlsContainer);
  
  // Format date for display
  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
  
  // Event listeners
  
  // Initialize timeline when time range changes
  earthquakeOverlay.onTimeRangeChange = (timeRange) => {
    slider.min = timeRange.start;
    slider.max = timeRange.end;
    slider.value = timeRange.start;
    
    dateRangeDisplay.textContent = `Range: ${formatDate(timeRange.start)} - ${formatDate(timeRange.end)}`;
    currentTimeDisplay.textContent = formatDate(timeRange.start);
    
    // Show the timeline
    container.style.display = 'block';
  };
  
  // Update timeline display when time changes
  earthquakeOverlay.onTimeChange = (time) => {
    slider.value = time;
    currentTimeDisplay.textContent = formatDate(time);
  };
  
  // Slider controls current time
  slider.addEventListener('input', () => {
    const time = parseInt(slider.value, 10);
    earthquakeOverlay.setTime(time, terrainBounds);
  });
  
  // Play button
  playButton.addEventListener('click', () => {
    earthquakeOverlay.manuallyPaused = false; // Clear manual pause flag
    earthquakeOverlay.play(terrainBounds);
  });
  
  // Pause button
  pauseButton.addEventListener('click', () => {
    earthquakeOverlay.pause();
  });
  
  // Stop button
  stopButton.addEventListener('click', () => {
    earthquakeOverlay.stop(terrainBounds);
  });
  
  // Speed select
  speedSelect.addEventListener('change', () => {
    earthquakeOverlay.setPlaybackSpeed(parseFloat(speedSelect.value));
  });
  
  return container;
}
