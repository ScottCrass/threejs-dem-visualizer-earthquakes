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
    this.selectedFeatureId = null;
    this.terrainMesh = null; // Store reference to terrain mesh for filtering
  }

  setBloomLayer(layer) {
    this.bloomLayer = layer;
  }

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

  geoToTerrain(lat, lon, depth, terrainBounds) {
    let x = ((lon - terrainBounds.minLon) / (terrainBounds.maxLon - terrainBounds.minLon)) * terrainBounds.width - (terrainBounds.width / 2);
    const y = ((lat - terrainBounds.minLat) / (terrainBounds.maxLat - terrainBounds.minLat)) * terrainBounds.height - (terrainBounds.height / 2);
    x = -x;
    const depthInMeters = depth * 1000;
    const z = -(depthInMeters / 25);
    return { x, y, z };
  }

  visualize(terrainBounds, timeFilter = null, terrainMesh = null) {
    if (!this.earthquakeData.length) return;

    // Store terrain mesh reference for use in other methods
    if (terrainMesh) {
      this.terrainMesh = terrainMesh;
    }

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

      // Filter out earthquakes above terrain if terrain mesh is provided
      if (this.terrainMesh) {
        const terrainHeight = this.getTerrainHeightAt(position.x, position.y, this.terrainMesh);
        if (position.z > terrainHeight) {
          return; // Skip this earthquake - it's above terrain
        }
      }

      const baseSize = Math.max(2, mag * 5);
      const referenceTime = timeFilter || Date.now();
      const ageInMs = referenceTime - time;
      const ageInHours = ageInMs / (1000 * 60 * 60);

      // scale
      let scale = 1.0;
      if (ageInHours >= 0 && ageInHours < 1) scale = Math.max(0.1, ageInHours); // Minimum scale of 0.1 for visibility
      else if (ageInHours < 0) scale = 0;

      // opacity
      let opacity = 1.0;
      if (ageInHours > 48) {
        const fade = Math.max(0, 1 - (ageInHours - 48) / (24 * 5));
        opacity = Math.max(0.1, fade);
      } else if (ageInHours < 0) {
        opacity = 0;
      }

      // color
      const baseColor = this.ageColor(ageInHours);
      let bloomMultiplier;
      if (ageInHours <= 2 && ageInHours >= 0) bloomMultiplier = 12.0;
      else if (ageInHours > 2 && ageInHours <= 12) bloomMultiplier = 12.0 - ((ageInHours - 2) / 10) * 6.0;
      else if (ageInHours > 12 && ageInHours <= 48) bloomMultiplier = 6.0 - ((ageInHours - 12) / 36) * 4.0;
      else bloomMultiplier = 1.2;
      const bloomColor = new Color(baseColor).multiplyScalar(bloomMultiplier);

      // reuse or create
      let entry = this.earthquakeVisualMap.get(feature.id);
      if (!entry) {
        const sphereGeometry = new SphereGeometry(baseSize * 2, 16, 16);
        const material = new MeshBasicMaterial({ color: bloomColor, transparent: true, opacity: 1.0 });
        const sphere = new Mesh(sphereGeometry, material);
        sphere.position.set(position.x, position.z, position.y);
        sphere.layers.set(0);
        sphere.layers.enable(this.bloomLayer);
        sphere.frustumCulled = false;
        sphere.userData = { earthquake: feature.properties, depth, magnitude: mag, time, isEarthquake: true, featureId: feature.id };

        const lineGeometry = new BufferGeometry();
        const lineVertices = new Float32Array([position.x, 0, position.y, position.x, position.z, position.y]);
        lineGeometry.setAttribute('position', new Float32BufferAttribute(lineVertices, 3));
        const lineMaterial = new LineBasicMaterial({ color: new Color(baseColor).multiplyScalar(2.0), transparent: true, opacity: 1.0 });
        const line = new Line(lineGeometry, lineMaterial);
        line.layers.set(0);

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

      // update
      entry.sphere.position.set(position.x, position.z, position.y);
      entry.sphere.scale.setScalar(3.0 * scale);
      entry.sphere.material.color.copy(bloomColor);
      entry.sphere.material.opacity = opacity;

      entry.line.geometry.attributes.position.array.set([
        position.x, 0, position.y,
        position.x, position.z, position.y
      ]);
      entry.line.geometry.attributes.position.needsUpdate = true;
      entry.line.material.color.set(new Color(baseColor).multiplyScalar(2.0));
      entry.line.material.opacity = opacity;

      activeIds.add(feature.id);
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

    if (this.selectedFeatureId && this.earthquakeVisualMap.has(this.selectedFeatureId)) {
      this.highlightEarthquake(this.selectedFeatureId);
    }

    if (this.onVisualize) this.onVisualize();
  }

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

  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    return this.visible;
  }

  getObject3D() {
    return this.group;
  }

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

  play(terrainBounds) {
    if (!this.timeRange.start || !this.timeRange.end) return;
    if (this.manuallyPaused) return;
    this.isPlaying = true;
    this.manuallyPaused = false;
    this.lastFrameTime = Date.now();
    this.animate(terrainBounds);
  }

  pause() {
    this.isPlaying = false;
    this.manuallyPaused = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  stop(terrainBounds) {
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.currentTime = this.timeRange.start;
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    this.visualize(terrainBounds, this.currentTime, this.terrainMesh);
  }

  setTime(time, terrainBounds) {
    this.currentTime = time;
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    this.visualize(terrainBounds, this.currentTime, this.terrainMesh);
  }

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
    this.visualize(terrainBounds, this.currentTime, this.terrainMesh);
    if (this.onTimeChange) this.onTimeChange(this.currentTime);
    if (this.isPlaying) {
      this.animationId = requestAnimationFrame(() => this.animate(terrainBounds));
    } else {
      this.animationId = null;
    }
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;
  }

  highlightEarthquake(featureId) {
    if (!this.earthquakeVisualMap) return;
    
    // Don't restore other earthquakes here - visualize() already sets correct colors
    // Just highlight the selected one
    const visual = this.earthquakeVisualMap.get(featureId);
    if (visual) {
      // Use a moderate highlight color instead of pure white
      // This prevents excessive bloom
      visual.sphere.material.color.setRGB(0.8, 0.8, 0.3); // Bright yellow instead of white
      visual.line.material.color.setRGB(0.8, 0.8, 0.3);
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

  setSelectedEarthquake(featureId, terrainBounds) {
    if (this.selectedFeatureId === featureId) return;
    
    const previousSelection = this.selectedFeatureId;
    this.selectedFeatureId = featureId;
    
    if (previousSelection && this.earthquakeVisualMap) {
      // Re-visualize to restore correct colors for all earthquakes
      this.visualize(terrainBounds, this.currentTime, this.terrainMesh);
    } else if (this.earthquakeVisualMap && featureId) {
      this.highlightEarthquake(featureId);
    }
  }

  clearSelectedEarthquake(terrainBounds) {
    if (this.selectedFeatureId !== null) {
      this.selectedFeatureId = null;
      // Just re-visualize to restore proper colors
      this.visualize(terrainBounds, this.currentTime, this.terrainMesh);
    }
  }

  // Helper method to get terrain height at a specific position
  getTerrainHeightAt(x, y, terrainMesh) {
    if (!terrainMesh || !terrainMesh.geometry) return 0;
    
    // Get the terrain geometry
    const geometry = terrainMesh.geometry;
    const position = geometry.attributes.position;
    
    if (!position) return 0;
    
    // Get terrain dimensions - assuming it's a PlaneGeometry or similar
    const terrainWidth = terrainMesh.scale.x;
    const terrainHeight = terrainMesh.scale.z;
    
    // Convert world coordinates to terrain UV coordinates
    const u = (x + terrainWidth / 2) / terrainWidth;
    const v = (y + terrainHeight / 2) / terrainHeight;
    
    // Clamp to terrain bounds
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    
    // For now, return a simple approximation
    // In a more sophisticated implementation, you would:
    // 1. Sample the actual height map texture
    // 2. Or interpolate between nearby vertices
    // 3. Or use raycasting against the terrain mesh
    
    // Simple approximation: assume terrain is roughly at y=0 to y=100
    // and earthquakes below y=0 are underground
    return 0;
  }
}
