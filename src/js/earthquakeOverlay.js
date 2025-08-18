// EarthquakeOverlay.js

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
 * EarthquakeOverlay
 * - Loads and visualizes earthquake data from the USGS API.
 * - Supports timeline playback and filtering.
 * - Renders spheres and lines for each earthquake, with color and bloom based on age.
 */
export class EarthquakeOverlay {
  constructor() {
    this.group = new Group();
    this.visible = true;
    this.earthquakeData = [];

    this.timeRange = { start: null, end: null };
    this.currentTime = null;
    this.isPlaying = false;
    this.playbackSpeed = 1;
    this.lastFrameTime = 0;
    this.animationId = null;
    this.manuallyPaused = false;

    this.onTimeRangeChange = null;
    this.onTimeChange = null;
    this.onVisualize = null;

    this.bloomLayer = 1;

    this.selectedFeatureId = null; // Track selected earthquake
  }

  /**
   * Set the layer to use for bloom effect.
   * @param {number} layer
   */
  setBloomLayer(layer) {
    this.bloomLayer = layer;
  }

  /**
   * Load earthquake data from USGS API for given bounds and date range.
   * @param {Object} bounds - {minLat, maxLat, minLon, maxLon}
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD (optional)
   * @returns {Promise}
   */
  async loadData(bounds = { minLat: 50, maxLat: 72, minLon: -190, maxLon: -129 }, startDate = '2025-07-01', endDate = null) {
    this.isLoading = true;
    try {
      const endDateParam = endDate || new Date().toISOString().split('T')[0];
      const url = `https://earthquake.usgs.gov/fdsnws/event/1/query.geojson?maxlatitude=${bounds.maxLat}&minlatitude=${bounds.minLat}&maxlongitude=${bounds.maxLon}&minlongitude=${bounds.minLon}&starttime=${startDate}&endtime=${endDateParam}&orderby=time&contributor=av`;
      const response = await fetch(url);
      const data = await response.json();
      this.earthquakeData = data.features || [];
      this.earthquakeData.sort((a, b) => a.properties.time - b.properties.time);

      if (this.earthquakeData.length > 0) {
        this.timeRange = {
          start: this.earthquakeData[0].properties.time,
          end: this.earthquakeData[this.earthquakeData.length - 1].properties.time
        };
        this.currentTime = this.timeRange.start;
        if (this.onTimeRangeChange) this.onTimeRangeChange(this.timeRange);
      }
      return this.earthquakeData;
    } catch (error) {
      console.error('Error loading earthquake data:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Remove all earthquake visuals and data.
   */
  clearData() {
    this.earthquakeData = [];
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
    this.timeRange = { start: null, end: null };
    this.currentTime = null;
  }

  /**
   * Convert geographic coordinates to terrain mesh coordinates.
   * @param {number} lat
   * @param {number} lon
   * @param {number} depth - in km
   * @param {Object} terrainBounds
   * @returns {{x, y, z}}
   */
  geoToTerrain(lat, lon, depth, terrainBounds) {
    let x = ((lon - terrainBounds.minLon) / (terrainBounds.maxLon - terrainBounds.minLon)) * terrainBounds.width - (terrainBounds.width / 2);
    const y = ((lat - terrainBounds.minLat) / (terrainBounds.maxLat - terrainBounds.minLat)) * terrainBounds.height - (terrainBounds.height / 2);
    x = -x;
    const depthInMeters = depth * 1000;
    const z = -(depthInMeters / 25);
    return { x, y, z };
  }

  /**
   * Visualize all earthquakes as spheres and lines.
   * @param {Object} terrainBounds
   * @param {number|null} timeFilter
   */
  visualize(terrainBounds, timeFilter = null) {
    if (!this.earthquakeData.length) return;

    if (!this.earthquakeVisualMap) {
      this.earthquakeVisualMap = new Map();
    }

    const activeIds = new Set();

    this.earthquakeData.forEach(feature => {
      const { coordinates } = feature.geometry;
      const { mag, time } = feature.properties;
      if (timeFilter && time > timeFilter) return;
      const [lon, lat, depth] = coordinates;
      const position = this.geoToTerrain(lat, lon, depth, terrainBounds);

      const baseSize = Math.max(2, mag * 12);

      const referenceTime = timeFilter || Date.now();
      const ageInMs = referenceTime - time;
      const ageInHours = ageInMs / (1000 * 60 * 60);

      // ----- scale
      let scale = 1.0;
      if (ageInHours >= 0 && ageInHours < 1) scale = ageInHours;
      else if (ageInHours < 0) scale = 0;

      // ----- opacity
      let opacity = 1.0;
      if (ageInHours > 48) {
        const fade = Math.max(0, 1 - (ageInHours - 48) / (24 * 5));
        opacity = Math.max(0.1, fade);
      } else if (ageInHours < 0) {
        opacity = 0;
      }

      // ----- color
      let color;
      if (ageInHours < 0) color = 0x000000;
      else if (ageInHours <= 2) color = 0xff0000;
      else if (ageInHours <= 48) {
        const normalizedAge = (ageInHours - 2) / (48 - 2);
        const r = 255;
        const g = Math.floor(165 * normalizedAge);
        color = (r << 16) | (g << 8);
      } else if (ageInHours <= 168) {
        const t = Math.min(1, (ageInHours - 48) / (168 - 48));
        const r = Math.round(255 * (1 - t));
        const g = Math.round(255 * (1 - t) + 128 * t);
        const b = Math.round(255 * t);
        color = (r << 16) | (g << 8) | b;
      } else {
        color = 0x0080ff;
      }

      // ----- bloom
      let bloomMultiplier;
      if (ageInHours <= 2 && ageInHours >= 0) bloomMultiplier = 12.0;
      else if (ageInHours > 2 && ageInHours <= 12) bloomMultiplier = 12.0 - ((ageInHours - 2) / 10) * 6.0;
      else if (ageInHours > 12 && ageInHours <= 48) bloomMultiplier = 6.0 - ((ageInHours - 12) / 36) * 4.0;
      else bloomMultiplier = 1.2;
      const bloomColor = new Color(color).multiplyScalar(bloomMultiplier);

      // ----- reuse or create
      let entry = this.earthquakeVisualMap.get(feature.id);
      if (!entry) {
        const sphereGeometry = new SphereGeometry(baseSize * 2, 8, 8);
        const material = new MeshBasicMaterial({ color: bloomColor, transparent: true, opacity });
        const sphere = new Mesh(sphereGeometry, material);
        sphere.layers.set(0);
        sphere.layers.enable(this.bloomLayer);
        sphere.frustumCulled = false;
        sphere.userData = { earthquake: feature.properties, depth, magnitude: mag, time, isEarthquake: true, featureId: feature.id };

        const lineGeometry = new BufferGeometry();
        const lineVertices = new Float32Array([position.x, 0, position.y, position.x, position.z, position.y]);
        lineGeometry.setAttribute('position', new Float32BufferAttribute(lineVertices, 3));
        const lineMaterial = new LineBasicMaterial({ color: new Color(color).multiplyScalar(2.0), transparent: true, opacity });
        const line = new Line(lineGeometry, lineMaterial);
        line.layers.mask = 1 | (1 << this.bloomLayer);

        this.group.add(sphere);
        this.group.add(line);

        entry = {
          sphere,
          line,
          originalColor: material.color.clone(),
          originalLineColor: lineMaterial.color.clone(),
          originalOpacity: material.opacity
        };
        this.earthquakeVisualMap.set(feature.id, entry);
      }

      // ----- update transforms & materials
      entry.sphere.position.set(position.x, position.z, position.y);
      entry.sphere.scale.setScalar(3.0 * scale);
      entry.sphere.material.color.copy(bloomColor);
      entry.sphere.material.opacity = opacity;

      entry.line.geometry.attributes.position.array.set([
        position.x, 0, position.y,
        position.x, position.z, position.y
      ]);
      entry.line.geometry.attributes.position.needsUpdate = true;
      entry.line.material.color.set(new Color(color).multiplyScalar(2.0));
      entry.line.material.opacity = opacity;

      activeIds.add(feature.id);
      
      bloomColor.multiplyScalar(bloomMultiplier);
      
      // Create a sphere for the earthquake with higher quality geometry
      const sphereGeometry = new SphereGeometry(size * 2, 16, 16); // Increased segments for smoother bloom
      
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
      
      // Put lines only on layer 0 (non-bloom layer) to avoid bloom artifacts
      line.layers.set(0); // Only layer 0, not bloom layer
    
      // No age-based opacity changes - keep lines consistent
      
      this.group.add(sphere);
      this.group.add(line);
    });

    // cleanup old
    for (let [id, entry] of this.earthquakeVisualMap) {
      if (!activeIds.has(id)) {
        this.group.remove(entry.sphere);
        this.group.remove(entry.line);
        if (entry.sphere.geometry) entry.sphere.geometry.dispose();
        if (entry.sphere.material) entry.sphere.material.dispose();
        if (entry.line.geometry) entry.line.geometry.dispose();
        if (entry.line.material) entry.line.material.dispose();
        this.earthquakeVisualMap.delete(id);
      }
    }

    // keep highlight alive
    if (this.selectedFeatureId && this.earthquakeVisualMap.has(this.selectedFeatureId)) {
      this.highlightEarthquake(this.selectedFeatureId);
    }

    if (this.onVisualize) this.onVisualize();
  }


  /**
   * Get color for an earthquake based on age (in hours).
   * @param {number} ageInHours
   * @returns {number} - hex color
   */

  ageColor(ageInHours) {
    if (ageInHours < 0) return 0xff0000;
    if (ageInHours <= 2) return 0xff0000;
    else if (ageInHours <= 48) {
      const normalizedAge = (ageInHours - 2) / (48 - 2);
      const r = 255;
      const g = Math.floor(165 * normalizedAge);
      const b = 0;
      return (r << 16) | (g << 8) | b;
    } else {
      return 0xffff00;
    }
  }

  /**
   * Toggle overlay visibility.
   * @returns {boolean}
   */
  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    return this.visible;
  }

  /**
   * Get the Three.js group for this overlay.
   * @returns {Group}
   */
  getObject3D() {
    return this.group;
  }

  /**
   * Find the closest earthquake to a given position.
   * @param {Vector3} position
   * @param {number} maxDistance
   * @returns {Object|null}
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
   * Start playback animation.
   * @param {Object} terrainBounds
   */
  play(terrainBounds) {
    if (!this.timeRange.start || !this.timeRange.end) return;
    if (this.manuallyPaused) return;
    this.isPlaying = true;
    this.manuallyPaused = false;
    this.lastFrameTime = Date.now();
    this.animate(terrainBounds);
  }

  /**
   * Pause playback animation.
   */
  pause() {
    this.isPlaying = false;
    this.manuallyPaused = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Stop playback and reset to start.
   * @param {Object} terrainBounds
   */
  stop(terrainBounds) {
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.currentTime = this.timeRange.start;
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    this.visualize(terrainBounds, this.currentTime);
  }

  /**
   * Set current time (e.g. from timeline slider).
   * @param {number} time
   * @param {Object} terrainBounds
   */
  setTime(time, terrainBounds) {
    this.currentTime = time;
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    this.visualize(terrainBounds, this.currentTime);
  }

  /**
   * Animation loop for playback.
   * @param {Object} terrainBounds
   */
  animate(terrainBounds) {
    if (!this.isPlaying) return;
    const now = Date.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    const dayInMs = 24 * 60 * 60 * 1000;
    this.currentTime += (deltaTime / 1000) * this.playbackSpeed * dayInMs;
    if (this.currentTime >= this.timeRange.end) {
      this.currentTime = this.timeRange.end;
      this.isPlaying = false;
    }
    this.visualize(terrainBounds, this.currentTime);
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    if (this.isPlaying) {
      this.animationId = requestAnimationFrame(() => this.animate(terrainBounds));
    } else {
      this.animationId = null;
    }
  }

  /**
   * Set playback speed (days per second).
   * @param {number} speed
   */
  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;
  }

  // Add highlight and unhighlight methods for selection
  highlightEarthquake(featureId) {
    if (!this.earthquakeVisualMap) return;
    // Unhighlight all first to ensure only one is highlighted
    for (const [id, visual] of this.earthquakeVisualMap.entries()) {
      if (id !== featureId) {
        visual.sphere.material.color.copy(visual.originalColor);
        visual.line.material.color.copy(visual.originalLineColor);
        visual.sphere.material.opacity = visual.originalOpacity;
        visual.line.material.opacity = visual.originalOpacity;
        visual.sphere.material.needsUpdate = true;
        visual.line.material.needsUpdate = true;
      }
    }
    const visual = this.earthquakeVisualMap.get(featureId);
    if (visual) {
      visual.sphere.material.color.setRGB(1, 1, 1);
      visual.line.material.color.setRGB(1, 1, 1);
      visual.sphere.material.opacity = 1.0;
      visual.line.material.opacity = 1.0;
      visual.sphere.material.needsUpdate = true;
      visual.line.material.needsUpdate = true;
    }
  }

  unhighlightEarthquake(featureId) {
    if (!this.earthquakeVisualMap) return;
    const visual = this.earthquakeVisualMap.get(featureId);
    if (visual) {
      visual.sphere.material.color.copy(visual.originalColor);
      visual.line.material.color.copy(visual.originalLineColor);
      visual.sphere.material.opacity = visual.originalOpacity;
      visual.line.material.opacity = visual.originalOpacity;
      visual.sphere.material.needsUpdate = true;
      visual.line.material.needsUpdate = true;
    }
  }

  /**
   * Set the selected earthquake by featureId.
   * @param {string|null} featureId
   * @param {Object} terrainBounds
   */
  setSelectedEarthquake(featureId) {
    if (this.selectedFeatureId === featureId) return;
    // Unhighlight previous selection if any
    if (this.selectedFeatureId && this.earthquakeVisualMap) {
      this.unhighlightEarthquake(this.selectedFeatureId);
    }
    this.selectedFeatureId = featureId;
    // Only highlight if visuals exist for this featureId
    if (this.earthquakeVisualMap && featureId) {
      this.highlightEarthquake(featureId);
    }
  }

  /**
   * Clear the selected earthquake.
   * @param {Object} terrainBounds
   */

  clearSelectedEarthquake(_terrainBounds) {
    if (this.selectedFeatureId !== null) {
      if (this.earthquakeVisualMap) {
        this.unhighlightEarthquake(this.selectedFeatureId);
        console.log(_terrainBounds);
      }
      this.selectedFeatureId = null;
      this.visualize(_terrainBounds, this.currentTime);
    }
  }

}
