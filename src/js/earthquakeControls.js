/**
 * Creates a UI control for the earthquake overlay
 */
export function createEarthquakeControls() {
  const container = document.createElement('div');
  container.className = 'earthquake-controls';
  container.style.position = 'absolute';
  container.style.top = '10px';
  container.style.right = '10px';
  container.style.backgroundColor = 'rgba(36, 36, 36, 0.7)';
  container.style.padding = '10px';
  container.style.borderRadius = '5px';
  container.style.zIndex = '1000';
  
  // Add title for the always-visible panel
  const title = document.createElement('h3');
  title.style.color = 'white';
  title.textContent = 'Earthquake Visualization';
  title.style.margin = '0 0 10px 0';
  title.style.fontSize = '14px';
  title.style.fontWeight = 'bold';
  
  // Add compass toggle
  const compassToggleDiv = document.createElement('div');
  compassToggleDiv.style.color = 'white';
  compassToggleDiv.style.marginBottom = '10px';
  compassToggleDiv.style.padding = '8px';
  compassToggleDiv.style.backgroundColor = 'rgba(55, 55, 55, 0.8)';
  compassToggleDiv.style.borderRadius = '3px';
  compassToggleDiv.style.display = 'flex';
  compassToggleDiv.style.justifyContent = 'space-between';
  compassToggleDiv.style.alignItems = 'center';
  
  const compassLabel = document.createElement('label');
  compassLabel.textContent = 'Compass Rose:';
  compassLabel.style.fontSize = '11px';
  compassLabel.style.fontWeight = 'bold';
  
  const compassCheckbox = document.createElement('input');
  compassCheckbox.type = 'checkbox';
  compassCheckbox.checked = true; // Show by default
  
  compassCheckbox.addEventListener('change', () => {
    const compassContainer = document.getElementById('compassContainer');
    if (compassContainer) {
      if (compassCheckbox.checked) {
        compassContainer.classList.remove('hidden');
      } else {
        compassContainer.classList.add('hidden');
      }
    }
  });
  
  compassToggleDiv.appendChild(compassLabel);
  compassToggleDiv.appendChild(compassCheckbox);
  
  // Add date range controls
  const dateRangeDiv = document.createElement('div');
  dateRangeDiv.style.color = 'white';
  dateRangeDiv.style.marginTop = '10px';
  dateRangeDiv.style.padding = '8px';
  dateRangeDiv.style.backgroundColor = 'rgba(55, 55, 55, 0.8)';
  dateRangeDiv.style.borderRadius = '3px';
  
  const dateRangeTitle = document.createElement('div');
  dateRangeTitle.textContent = 'Data Range:';
  dateRangeTitle.style.fontWeight = 'bold';
  dateRangeTitle.style.fontSize = '12px';
  dateRangeTitle.style.marginBottom = '5px';
  
  // Start date input
  const startDateDiv = document.createElement('div');
  startDateDiv.style.marginBottom = '5px';
  
  const startLabel = document.createElement('label');
  startLabel.textContent = 'Start: ';
  startLabel.style.fontSize = '11px';
  startLabel.style.display = 'inline-block';
  startLabel.style.width = '45px';
  
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.style.fontSize = '10px';
  startDateInput.style.width = '120px';
  
  // Set default start date to one week ago
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  startDateInput.value = oneWeekAgo.toISOString().split('T')[0];
  
  startDateDiv.appendChild(startLabel);
  startDateDiv.appendChild(startDateInput);
  
  // End date input
  const endDateDiv = document.createElement('div');
  endDateDiv.style.marginBottom = '5px';
  
  const endLabel = document.createElement('label');
  endLabel.textContent = 'End: ';
  endLabel.style.fontSize = '11px';
  endLabel.style.display = 'inline-block';
  endLabel.style.width = '45px';
  
  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.style.fontSize = '10px';
  endDateInput.style.width = '120px';
  
  // Set default end date to today
  const today = new Date();
  endDateInput.value = today.toISOString().split('T')[0];
  
  endDateDiv.appendChild(endLabel);
  endDateDiv.appendChild(endDateInput);
  
  // Load data button
  const loadButton = document.createElement('button');
  loadButton.id = 'load-data-btn';
  loadButton.textContent = 'Load Data';
  loadButton.style.width = '100%';
  loadButton.style.padding = '5px';
  loadButton.style.fontSize = '11px';
  loadButton.style.backgroundColor = '#4CAF50';
  loadButton.style.color = 'white';
  loadButton.style.border = 'none';
  loadButton.style.borderRadius = '3px';
  loadButton.style.cursor = 'pointer';
  loadButton.style.marginTop = '5px';
  
  loadButton.addEventListener('click', () => {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    
    if (startDate && endDate) {
      if (startDate <= endDate) {
        // Dispatch custom event with date range
        const loadDataEvent = new CustomEvent('loadEarthquakeData', {
          detail: { startDate, endDate }
        });
        document.dispatchEvent(loadDataEvent);
      } else {
        alert('Start date must be before or equal to end date');
      }
    } else {
      alert('Please select both start and end dates');
    }
  });
  
  dateRangeDiv.appendChild(dateRangeTitle);
  dateRangeDiv.appendChild(startDateDiv);
  dateRangeDiv.appendChild(endDateDiv);
  dateRangeDiv.appendChild(loadButton);
  
  // Add bloom intensity control
  const bloomControlDiv = document.createElement('div');
  bloomControlDiv.style.color = 'white';
  bloomControlDiv.style.marginTop = '10px';
  
  const bloomLabel = document.createElement('label');
  bloomLabel.textContent = 'Glow Intensity: ';
  bloomLabel.style.display = 'block';
  bloomLabel.style.marginBottom = '5px';
  
  const bloomSlider = document.createElement('input');
  bloomSlider.type = 'range';
  bloomSlider.min = '0';
  bloomSlider.max = '3';
  bloomSlider.step = '0.1';
  bloomSlider.value = '1.2';
  bloomSlider.style.width = '100%';
  
  bloomSlider.addEventListener('input', (event) => {
    // Dispatch a custom event that the main app can listen for
    const bloomStrengthEvent = new CustomEvent('bloomStrengthChange', {
      detail: { strength: parseFloat(event.target.value) }
    });
    document.dispatchEvent(bloomStrengthEvent);
  });
  
  bloomControlDiv.appendChild(bloomLabel);
  bloomControlDiv.appendChild(bloomSlider);
  
  // Add terrain opacity control
  const opacityControlDiv = document.createElement('div');
  opacityControlDiv.style.color = 'white';
  opacityControlDiv.style.marginTop = '10px';
  
  const opacityLabel = document.createElement('label');
  opacityLabel.textContent = 'Terrain Opacity: ';
  opacityLabel.style.display = 'block';
  opacityLabel.style.marginBottom = '5px';
  
  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.min = '0';
  opacitySlider.max = '1';
  opacitySlider.step = '0.01'; // Much finer steps for smoother opacity control
  opacitySlider.value = '1';
  opacitySlider.style.width = '100%';
  
  // Add value display
  const opacityValue = document.createElement('span');
  opacityValue.textContent = '1.00';
  opacityValue.style.marginLeft = '10px';
  opacityValue.style.fontSize = '12px';
  
  opacitySlider.addEventListener('input', (event) => {
    const opacityVal = parseFloat(event.target.value);
    opacityValue.textContent = opacityVal.toFixed(2);
    
    // Dispatch a custom event that the main app can listen for
    const opacityEvent = new CustomEvent('terrainOpacityChange', {
      detail: { opacity: opacityVal }
    });
    document.dispatchEvent(opacityEvent);
  });
  
  opacityControlDiv.appendChild(opacityLabel);
  opacityControlDiv.appendChild(opacitySlider);
  opacityControlDiv.appendChild(opacityValue);
  
  // Add terrain brightness control
  const brightnessControlDiv = document.createElement('div');
  brightnessControlDiv.style.color = 'white';
  brightnessControlDiv.style.marginTop = '10px';
  
  const brightnessLabel = document.createElement('label');
  brightnessLabel.textContent = 'Terrain Brightness: ';
  brightnessLabel.style.display = 'block';
  brightnessLabel.style.marginBottom = '5px';
  
  const brightnessSlider = document.createElement('input');
  brightnessSlider.type = 'range';
  brightnessSlider.min = '0.1';
  brightnessSlider.max = '2.0';
  brightnessSlider.step = '0.05';
  brightnessSlider.value = '1.0';
  brightnessSlider.style.width = '100%';
  
  // Add value display
  const brightnessValue = document.createElement('span');
  brightnessValue.style.color = 'white';
  brightnessValue.textContent = '1.00';
  brightnessValue.style.marginLeft = '10px';
  brightnessValue.style.fontSize = '12px';
  
  brightnessSlider.addEventListener('input', (event) => {
    const brightnessVal = parseFloat(event.target.value);
    brightnessValue.textContent = brightnessVal.toFixed(2);
    
    // Dispatch a custom event that the main app can listen for
    const brightnessEvent = new CustomEvent('terrainBrightnessChange', {
      detail: { brightness: brightnessVal }
    });
    document.dispatchEvent(brightnessEvent);
  });
  
  brightnessControlDiv.appendChild(brightnessLabel);
  brightnessControlDiv.appendChild(brightnessSlider);
  brightnessControlDiv.appendChild(brightnessValue);
  
  const infoDiv = document.createElement('div');
  infoDiv.id = 'earthquake-info';
  infoDiv.style.marginTop = '10px';
  infoDiv.style.padding = '8px';
  infoDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
  infoDiv.style.border = '1px solid #ccc';
  infoDiv.style.borderRadius = '4px';
  infoDiv.style.fontSize = '12px';
  infoDiv.style.lineHeight = '1.4';
  infoDiv.style.display = 'none';
  infoDiv.style.maxWidth = '200px';
  infoDiv.style.wordWrap = 'break-word';
  
  container.appendChild(title);
  container.appendChild(compassToggleDiv);
  container.appendChild(dateRangeDiv);
  container.appendChild(bloomControlDiv);
  container.appendChild(opacityControlDiv);
  container.appendChild(brightnessControlDiv);
  container.appendChild(infoDiv);
  return container;
}
