import {
  SphereGeometry,
  MeshBasicMaterial,
  Mesh,
  Group,
  BufferGeometry,
  LineBasicMaterial,
  Line,
  Float32BufferAttribute,
  Color,
} from 'three';

/**
 * EarthquakeOverlay - A class to visualize earthquake data on top of the terrain
 */
export class EarthquakeOverlay {
  constructor() {
    this.group = new Group();
    this.visible = true; // Always visible by default
    this.earthquakeData = [];
    this.isLoading = false;
    
    // Time-related properties for playback
    this.timeRange = { start: null, end: null };
    this.currentTime = null;
    this.isPlaying = false;
    this.playbackSpeed = 1; // Days per second
    this.lastFrameTime = 0;
    this.animationId = null; // Track animation frame ID for proper cancellation
    this.manuallyPaused = false; // Track if user manually paused to prevent auto-resume
    
    // Event callbacks
    this.onTimeRangeChange = null;
    this.onTimeChange = null;
    this.onVisualize = null; // Called after visualization is complete
    
    // Bloom layer
    this.bloomLayer = 1; // Default to layer 1
  }
  
  /**
   * Set the layer to use for bloom effect
   * @param {number} layer - Layer number for bloom effect
   */
  setBloomLayer(layer) {
    this.bloomLayer = layer;
  }

  /**
   * Load earthquake data from USGS API
   * @param {Object} bounds - Geographic bounds for the query
   * @param {number} bounds.minLat - Minimum latitude
   * @param {number} bounds.maxLat - Maximum latitude
   * @param {number} bounds.minLon - Minimum longitude
   * @param {number} bounds.maxLon - Maximum longitude
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @returns {Promise} - Promise that resolves when data is loaded
   */

  async loadData(bounds = {
    minLat: 50,
    maxLat: 72,
    minLon: -190,
    maxLon: -129
  }, startDate = '2025-07-01', endDate = null) {
    this.isLoading = true;
    
    try {
      // Use current date as end date if not provided
      const endDateParam = endDate || new Date().toISOString().split('T')[0];
      
      // Construct the URL for the USGS Earthquake API
      const url = `https://earthquake.usgs.gov/fdsnws/event/1/query.geojson?maxlatitude=${bounds.maxLat}&minlatitude=${bounds.minLat}&maxlongitude=${bounds.maxLon}&minlongitude=${bounds.minLon}&starttime=${startDate}&endtime=${endDateParam}&orderby=time&contributor=av`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      console.log(`Loaded ${data.features.length} earthquakes`);
      this.earthquakeData = data.features;
      
      // Sort earthquakes by time (oldest first)
      this.earthquakeData.sort((a, b) => a.properties.time - b.properties.time);
      
      // Extract time range
      if (this.earthquakeData.length > 0) {
        this.timeRange = {
          start: this.earthquakeData[0].properties.time,
          end: this.earthquakeData[this.earthquakeData.length - 1].properties.time
        };
        
        // Set current time to start of the range
        this.currentTime = this.timeRange.start;
        
        // Notify listeners of time range change
        if (this.onTimeRangeChange) {
          this.onTimeRangeChange(this.timeRange);
        }
      }
      
      return data.features;
    } catch (error) {
      console.error('Error loading earthquake data:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Clear all earthquake data and visual objects
   */
  clearData() {
    // Clear the earthquake data array
    this.earthquakeData = [];
    
    // Remove all children from the group (visual objects)
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      
      // Dispose of geometry and material to free memory
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    
    // Reset time range
    this.timeRange = { start: null, end: null };
    this.currentTime = null;
    
    console.log('Earthquake data and visual objects cleared');
  }
  
  /**
   * Map geographic coordinates to terrain coordinates
   * @param {number} lat - Latitude in decimal degrees
   * @param {number} lon - Longitude in decimal degrees
   * @param {number} depth - Depth in kilometers
   * @param {Object} terrainBounds - Bounds of the terrain (includes center point and calculated bounds)
   * @returns {Object} - {x, y, z} coordinates on the terrain
   */
  geoToTerrain(lat, lon, depth, terrainBounds) {
    // Calculate position on terrain with proper centering
    // The terrain is centered at origin, so we need to offset by half the dimensions
    // This works with the MAP_CONFIG center point and calculated bounds
    let x = ((lon - terrainBounds.minLon) / (terrainBounds.maxLon - terrainBounds.minLon)) * terrainBounds.width - (terrainBounds.width / 2);
    const y = ((lat - terrainBounds.minLat) / (terrainBounds.maxLat - terrainBounds.minLat)) * terrainBounds.height - (terrainBounds.height / 2);
    
    // IMPORTANT: The terrain mesh has scale.x = -1 (horizontal flip), so we need to flip X coordinates to match
    x = -x;
    
    // Z value (height) derived from depth - match terrain's vertical scale
    // Terrain uses: (elevation_in_meters / 25) * -1
    // For earthquakes: convert km to meters, then apply same scale
    // Depth is positive (below surface), so we make it negative for proper positioning
    const depthInMeters = depth * 1000; // Convert km to meters
    const z = -(depthInMeters / 25); // Match terrain scale: negative because it's below surface
    
    return { x, y, z };
  }
  
  /**
   * Visualize earthquakes on the terrain
   * @param {Object} terrainBounds - Bounds of the terrain
   */
  visualize(terrainBounds, timeFilter = null) {
    // Clear previous visualization
    while (this.group.children.length > 0) {
      const object = this.group.children[0];
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
      this.group.remove(object);
    }
    
    if (!this.earthquakeData.length) {
      console.warn('No earthquake data to visualize');
      return;
    }
    
    // Create visualizations for each earthquake
    this.earthquakeData.forEach(feature => {
      const { coordinates } = feature.geometry;
      const { mag, time } = feature.properties;
      
      // Skip this earthquake if it doesn't meet the time filter
      if (timeFilter && time > timeFilter) {
        return;
      }
      
      // No age-based fading - just use age-based colors
      // Age-based fading interferes with the timeline visualization
      
      // Extract longitude, latitude, depth
      const [lon, lat, depth] = coordinates;
      
      // Map to terrain coordinates
      const position = this.geoToTerrain(lat, lon, depth, terrainBounds);
      
      // Size based on magnitude
      const size = Math.max(2, mag * 12);
      
      // Calculate age in hours relative to the current timeline position (not current real time)
      const referenceTime = timeFilter || Date.now(); // Use timeline time if filtering, otherwise current time
      const earthquakeTime = time;
      const ageInHours = (referenceTime - earthquakeTime) / (1000 * 60 * 60);
      
      // Color based on age relative to timeline position (red for recent, orange for medium, yellow for old)
      const color = this.ageColor(ageInHours);
      
      // Use a bright color that will bloom well - make it much brighter
      const bloomColor = new Color(color);
      
      // Calculate bloom brightness based on age - fresher earthquakes bloom more intensely
      let bloomMultiplier;
      if (ageInHours <= 2) {
        // Last 2 hours: maximum bloom (12x brightness)
        bloomMultiplier = 12.0;
      } else if (ageInHours <= 12) {
        // 2 hours to 12 hours: fade from 12x to 6x brightness
        const ageProgress = (ageInHours - 2) / (12 - 2); // 0 to 1 over 2 hours to 12 hours
        bloomMultiplier = 12.0 - (ageProgress * 6.0); // 12.0 down to 6.0
      } else if (ageInHours <= 48) {
        // 12 hours to 2 days: fade from 6x to 2x brightness
        const ageProgress = (ageInHours - 12) / (48 - 12); // 0 to 1 over 12 hours to 2 days
        bloomMultiplier = 6.0 - (ageProgress * 4.0); // 6.0 down to 2.0
      } else {
        // Older than 2 days: very minimal bloom (1.2x brightness)
        bloomMultiplier = 1.2;
      }
      
      bloomColor.multiplyScalar(bloomMultiplier);
      
      // Create a sphere for the earthquake
      const sphereGeometry = new SphereGeometry(size * 2, 8, 8); // Double the base size for easier clicking
      
      // Use a simple MeshBasicMaterial for better bloom performance
      const material = new MeshBasicMaterial({
        color: bloomColor,
        transparent: true,
        opacity: 1.0, // Full opacity - let bloom layer handle the glow
      });
      
      const sphere = new Mesh(sphereGeometry, material);
      sphere.position.set(position.x, position.z, position.y); // Note the swapped y and z for Three.js
      
      // Set earthquake on both layers for proper functionality:
      // - Layer 0 for raycasting and terrain compatibility
      // - Bloom layer for glow effect
      sphere.layers.set(0); // Start with layer 0 (raycasting)
      sphere.layers.enable(this.bloomLayer); // Add bloom layer for glow
      
      // DEBUG: Log actual layer mask after setting
      console.log(`Earthquake sphere created - bloomLayer: ${this.bloomLayer}, layers mask: ${sphere.layers.mask}`);
      
      // Scale up immediately for easier clicking (no delayed scaling)
      sphere.scale.setScalar(3.0);
      
      // CRITICAL FIX: Disable frustum culling to ensure earthquakes are always raycastable
      // This prevents Three.js from culling small spheres that appear outside the camera frustum
      sphere.frustumCulled = false;
      
      // Add user data for interaction
      sphere.userData = {
        earthquake: feature.properties,
        depth,
        magnitude: mag,
        time,
        isEarthquake: true // Flag to identify as an earthquake object
      };
      
      // Add a line from the surface to the earthquake depth
      const lineGeometry = new BufferGeometry();
      const lineVertices = new Float32Array([
        position.x, 0, position.y,
        position.x, position.z, position.y
      ]);
      lineGeometry.setAttribute('position', new Float32BufferAttribute(lineVertices, 3));
      
      const lineMaterial = new LineBasicMaterial({
        color: new Color(this.ageColor(ageInHours)).multiplyScalar(2.0), // Color matches sphere now
        transparent: true,
        opacity: 1 // Fixed opacity for consistent glow
      });
      
      const line = new Line(lineGeometry, lineMaterial);
      
      // Put lines on both layers too for consistency
      line.layers.mask = 1 | (1 << this.bloomLayer); // Both layer 0 and bloom layer
      
      // No age-based opacity changes - keep lines consistent
      
      this.group.add(sphere);
      this.group.add(line);
    });
    
    // Call visualization callback if set (for post-processing like layer assignment)
    if (this.onVisualize) {
      this.onVisualize();
    }
  }
  
  /**
   * Generate a color based on earthquake age relative to timeline position
   * @param {number} ageInHours - Age of earthquake in hours relative to timeline
   * @returns {number} - Color value
   */

  ageColor(ageInHours) {
    // Handle future earthquakes (relative to timeline) - make them very bright red
    if (ageInHours < 0) {
      return 0xff0000; // Pure red for "future" earthquakes
    }
    
    if (ageInHours <= 2) {
      // Last 2 hours relative to timeline: bright red
      return 0xff0000; // Pure red
    } else if (ageInHours <= 48) {
      // Last 2 days relative to timeline: orange (transition from red to orange)
      const normalizedAge = (ageInHours - 2) / (48 - 2); // 0 to 1 over 2 hours to 2 days
      const r = 255;
      const g = Math.floor(165 * normalizedAge); // 0 to 165 (red to orange)
      const b = 0;
      return (r << 16) | (g << 8) | b;
    } else {
      // Older than 2 days relative to timeline: yellow
      return 0xffff00; // Pure yellow
    }
  }
  
  /**
   * Toggle the visibility of the earthquake overlay
   * @returns {boolean} - New visibility state
   */
  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    return this.visible;
  }
  
  /**
   * Get the Three.js group containing all earthquake visualizations
   * @returns {Group} - Three.js Group
   */
  getObject3D() {
    return this.group;
  }
  
  /**
   * Find the closest earthquake to a given 3D position
   * @param {Vector3} position - Position to check
   * @param {number} maxDistance - Maximum distance to consider
   * @returns {Object|null} - Closest earthquake or null if none found
   */
  findClosestEarthquake(position, maxDistance = 50) {
    let closest = null;
    let minDistance = maxDistance;
    
    this.group.children.forEach(child => {
      if (child instanceof Mesh) {
        const distance = position.distanceTo(child.position);
        if (distance < minDistance) {
          minDistance = distance;
          closest = child;
        }
      }
    });
    
    return closest ? closest.userData : null;
  }
  
  /**
   * Start the playback animation
   */
  play(terrainBounds) {
    if (!this.timeRange.start || !this.timeRange.end) return;
    
    // Prevent auto-resume if user manually paused
    if (this.manuallyPaused) {
      console.log('Auto-resume blocked - user manually paused timeline');
      return;
    }
    
    console.log('EarthquakeOverlay.play() called - starting playback');
    console.trace('Play called from:'); // This will show the call stack
    this.isPlaying = true;
    this.manuallyPaused = false; // Clear manual pause flag when explicitly playing
    this.lastFrameTime = Date.now();
    this.animate(terrainBounds);
  }
  
  /**
   * Pause the playback animation
   */
  pause() {
    console.log('EarthquakeOverlay.pause() called - stopping playback');
    this.isPlaying = false;
    this.manuallyPaused = true; // Mark as manually paused to prevent auto-resume
    // Cancel any pending animation frame to ensure immediate stop
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
      console.log('Cancelled pending animation frame');
    }
  }
  
  /**
   * Stop the playback and reset to the beginning
   */
  stop(terrainBounds) {
    this.isPlaying = false;
    // Cancel any pending animation frame
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.currentTime = this.timeRange.start;
    if (this.onTimeChange) {
      this.onTimeChange(this.currentTime);
    }
    this.visualize(terrainBounds, this.currentTime);
  }
  
  /**
   * Set the current time directly (e.g. from timeline slider)
   * @param {number} time - Timestamp to set
   * @param {Object} terrainBounds - Terrain bounds for visualization update
   */
  setTime(time, terrainBounds) {
    this.currentTime = time;
    if (this.onTimeChange) {
      this.onTimeChange(this.currentTime);
    }
    this.visualize(terrainBounds, this.currentTime);
  }
  
  /**
   * Animation loop for playback
   * @param {Object} terrainBounds - Terrain bounds for visualization update
   */
  animate(terrainBounds) {
    if (!this.isPlaying) return;
    
    const now = Date.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    // Advance time based on playback speed
    // playbackSpeed is in days per second
    const dayInMs = 24 * 60 * 60 * 1000;
    this.currentTime += (deltaTime / 1000) * this.playbackSpeed * dayInMs;
    
    // Check if we've reached the end
    if (this.currentTime >= this.timeRange.end) {
      this.currentTime = this.timeRange.end;
      this.isPlaying = false;
    }
    
    // Update visualization to show color changes over time with consistent bloom
    this.visualize(terrainBounds, this.currentTime);
    
    // Notify listeners
    if (this.onTimeChange) {
      this.onTimeChange(this.currentTime);
    }
    
    // Continue animation if still playing
    if (this.isPlaying) {
      this.animationId = requestAnimationFrame(() => this.animate(terrainBounds));
    } else {
      // Clear animation ID when stopping
      this.animationId = null;
    }
  }
  
  /**
   * Set playback speed
   * @param {number} speed - Speed in days per second
   */
  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;
  }
}
