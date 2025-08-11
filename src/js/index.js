import * as THREE from 'three';
import {
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  AmbientLight,
  WebGLRenderer,
  PlaneGeometry,
  GridHelper,
  AxesHelper,
  TextureLoader,
  MeshLambertMaterial,
  DoubleSide,
  Mesh,
  Raycaster,
  Vector2,
  Clock,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'; // import min because three.js is not tree-shakable for now
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Detector from '../js/vendor/Detector';
// TODO: Major performance problems on reading big images
// import terrain from '../textures/agri-medium-dem.tif';
// import mountainImage from '../textures/agri-medium-autumn.jpg';

import terrain from '../textures/spurr_20_mile_rad_dem_smaller_trimmed.tif';
import mountainImage from '../textures/spurr_round_usgs_sat_overlay.jpg';
import { EarthquakeOverlay } from './earthquakeOverlay';
import { createEarthquakeControls } from './earthquakeControls';
import { createEarthquakeTimeline } from './earthquakeTimeline';

require('../sass/home.sass');

class Application {
  constructor(opts = {}) {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.mouse = new Vector2();
    this.raycaster = new Raycaster();
    this.clock = new Clock();
    
    // Initialize terrain bounds - will be updated from GeoTIFF metadata
    this.terrainBounds = {
      minLat: 0,
      maxLat: 0,
      minLon: 0,
      maxLon: 0,
      center: { latitude: 0, longitude: 0 }, // Will be calculated from GeoTIFF bounds
      radiusMiles: 0, // Will be calculated from GeoTIFF bounds
      width: 0,   // Will be set after terrain is loaded
      height: 0   // Will be set after terrain is loaded
    };
    
    console.log('Terrain bounds will be extracted from GeoTIFF metadata...');
    
    // Layer for bloom effect
    this.BLOOM_SCENE = 1;
    this.bloomLayer = new THREE.Layers();

    if (opts.container) {
      this.container = opts.container;
    } else {
      const div = Application.createContainer();
      document.body.appendChild(div);
      this.container = div;
    }

    // Initialize earthquake overlay
    this.earthquakeOverlay = new EarthquakeOverlay();

    if (Detector.webgl) {
      this.init();
      // Don't setup earthquake overlay here - it will be done after terrain loads
      this.render();
    } else {
      // TODO: style warning message
      console.log('WebGL NOT supported in your browser!');
      const warning = Detector.getWebGLErrorMessage();
      this.container.appendChild(warning);
    }
  }

  init() {
    this.scene = new Scene();
    this.setupCamera();
    this.setupRenderer();
    this.setupControls();
    this.setupLight();
    this.setupTerrainModel();
    this.setupHelpers();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      // Update renderer size
      this.renderer.setSize(w, h);
      
      // Update camera aspect ratio
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      
      // Update bloom composer if it exists
      if (this.bloomComposer) {
        this.bloomComposer.setSize(w, h);
      }
    });
    
    // Now that the camera is initialized, set up the bloom effect
    this.setupBloom();
  }

  render() {
    this.controls.update();
    
    // If the earthquake overlay is visible and we're hovering, update highlighting
    if (this.earthquakeOverlay.visible) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.earthquakeOverlay.getObject3D().children);
      
      // Reset all earthquake markers to normal state
      this.earthquakeOverlay.getObject3D().children.forEach(child => {
        if (child.material && child.material.opacity !== undefined) {
          if (child.material.type === 'LineBasicMaterial') {
            child.material.opacity = 0.3;
          } else if (child.material.type === 'MeshBasicMaterial') {
            child.material.opacity = 0.7;
            // Adjust color intensity based on magnitude
            if (child.userData && child.userData.magnitude) {
              const magNormalized = Math.min(Math.max(child.userData.magnitude, 0), 10) / 10;
              child.material.opacity = 0.4 + magNormalized * 0.6;
            }
          }
          child.material.needsUpdate = true;
        }
      });
      
      // Highlight the hovered earthquake
      if (intersects.length > 0) {
        intersects[0].object.material.opacity = 1.0;
        intersects[0].object.material.needsUpdate = true;
      }
    }

    // Simple approach: use the bloom composer for everything
    // The bloom will only affect objects in the correct layer
    this.bloomComposer.render();
    
    // Continue animation loop
    requestAnimationFrame(() => this.render());
  }

  static createContainer() {
    const div = document.createElement('div');
    div.setAttribute('id', 'canvas-container');
    div.setAttribute('class', 'container');
    return div;
  }

  setupRenderer() {
    this.renderer = new WebGLRenderer({ 
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000011); // Dark blue-black for better contrast with glowing earthquakes
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputEncoding = THREE.sRGBEncoding; // Improved color rendering
    
    // Ensure consistent texture handling
    this.renderer.toneMapping = THREE.NoToneMapping;
    
    this.container.appendChild(this.renderer.domElement);
    
    // Setup bloom effect and composer after the camera is initialized
    // We'll do this at the end of the init method
    
    // Resize handling is now done in the init method
  }
  
  setupBloom() {
    // Standard bloom setup with selective bloom based on layers
    
    // Create the composer
    this.bloomComposer = new EffectComposer(this.renderer);
    
    // Add render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloomComposer.addPass(renderPass);
    
    // Add bloom pass with tuned parameters for selective bloom
    const bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      2.0,  // strength - increased for more intense bloom
      0.6,  // radius - increased for more spread
      0.6   // threshold - lowered so earthquakes can bloom easier
    );
    
    this.bloomPass = bloomPass;
    this.bloomComposer.addPass(bloomPass);
    
    // Set up layers properly
    this.bloomLayer.set(this.BLOOM_SCENE);
    
    // Configure camera layers to see only default layer for normal rendering
    this.camera.layers.set(0); // Only default layer
    
    // Make sure all existing objects are on the correct layers
    this.scene.traverse(obj => {
      if (obj.isMesh) {
        // All objects start on default layer only
        obj.layers.set(0);
      }
    });
  }

  setupCamera() {
    const fov = 75;
    const aspect = this.width / this.height;
    const near = 0.1;
    const far = 10000;
    this.camera = new PerspectiveCamera(fov, aspect, near, far);
    this.camera.position.set(1000, 1000, 1000);
    this.camera.lookAt(this.scene.position);
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = true;
    this.controls.maxDistance = 1500;
    this.controls.minDistance = 0;
    this.controls.autoRotate = false; // Disable automatic rotation
  }

  setupLight() {
    // Main directional light for the terrain
    this.light = new DirectionalLight(0xffffff, 0.8);
    this.light.position.set(500, 1000, 250);
    this.scene.add(this.light);
    
    // Add ambient light to improve visibility of glowing earthquakes
    this.ambientLight = new AmbientLight(0x333333);
    this.scene.add(this.ambientLight);
  }

  setupTerrainModel() {
    const readGeoTif = async () => {
      const rawTiff = await GeoTIFF.fromUrl(terrain);
      const tifImage = await rawTiff.getImage();
      const image = {
        width: tifImage.getWidth(),
        height: tifImage.getHeight(),
      };
      console.log('Image dimensions:', image);
      
      // Extract geographic bounds from GeoTIFF metadata
      const bbox = tifImage.getBoundingBox();
      console.log('GeoTIFF Bounding Box:', bbox);
      
      // Check if we have projection information
      const geoKeys = tifImage.getGeoKeys();
      console.log('GeoTIFF GeoKeys:', geoKeys);
      
      // Check if coordinates are in a projected system (values > 180 indicate projected coordinates)
      const isProjected = Math.abs(bbox[0]) > 180 || Math.abs(bbox[1]) > 180 || Math.abs(bbox[2]) > 180 || Math.abs(bbox[3]) > 180;
      console.log('Is projected coordinate system:', isProjected);
      
      let finalBounds;
      
      if (isProjected) {
        // If projected, we need to fall back to manual bounds for now
        // This is Mount Spurr area in Alaska - using known geographic bounds
        console.log('Using fallback geographic bounds for Mount Spurr area');
        finalBounds = {
          minLon: -152.4,  // West
          minLat: 61.15,   // South  
          maxLon: -152.1,  // East
          maxLat: 61.45    // North
        };
      } else {
        // Direct lat/lon coordinates
        finalBounds = {
          minLon: bbox[0], // West
          minLat: bbox[1], // South  
          maxLon: bbox[2], // East
          maxLat: bbox[3]  // North
        };
      }
      
      // Update terrain bounds with proper geographic bounds
      this.terrainBounds.minLon = finalBounds.minLon;
      this.terrainBounds.minLat = finalBounds.minLat;
      this.terrainBounds.maxLon = finalBounds.maxLon;
      this.terrainBounds.maxLat = finalBounds.maxLat;
      this.terrainBounds.width = image.width;
      this.terrainBounds.height = image.height;
      
      // Calculate center from actual bounds
      this.terrainBounds.center = {
        latitude: (finalBounds.minLat + finalBounds.maxLat) / 2,
        longitude: (finalBounds.minLon + finalBounds.maxLon) / 2
      };
      
      // Calculate radius in miles (approximate)
      const latDiff = finalBounds.maxLat - finalBounds.minLat;
      const lonDiff = finalBounds.maxLon - finalBounds.minLon;
      const latRadius = (latDiff * 69) / 2; // degrees to miles
      const lonRadius = (lonDiff * 54.6) / 2; // approximate for this latitude
      this.terrainBounds.radiusMiles = Math.max(latRadius, lonRadius);
      
      console.log('Updated terrain bounds from GeoTIFF:');
      console.log(`  Center: ${this.terrainBounds.center.latitude}, ${this.terrainBounds.center.longitude}`);
      console.log(`  Bounds: lat(${finalBounds.minLat} to ${finalBounds.maxLat}), lon(${finalBounds.minLon} to ${finalBounds.maxLon})`);
      console.log(`  Approximate radius: ${this.terrainBounds.radiusMiles.toFixed(2)} miles`);
      
      /* 
      The third and fourth parameter are image segments and we are subtracting one from each,
       otherwise our 3D model goes crazy.
       https://github.com/mrdoob/three.js/blob/master/src/geometries/PlaneGeometry.js#L57
       */
      const geometry = new PlaneGeometry(
        image.width,
        image.height,
        image.width - 1,
        image.height - 1
      );
      const data = await tifImage.readRasters({ interleave: true });
      console.time('parseGeom');
      // Get index array from the existing geometry
      const indexAttribute = geometry.getIndex();
      const indices = indexAttribute ? indexAttribute.array : null;
      // If we have indices, we'll create a new array with only valid triangles
      if (indices) {
        const newIndices = [];
        // Process triangles (indices come in groups of 3)
        for (let i = 0; i < indices.length; i += 3) {
          const idx1 = indices[i];
          const idx2 = indices[i + 1];
          const idx3 = indices[i + 2];
          // Only keep triangles where none of the vertices has a value of -9999
          if (data[idx1] !== -9999 && data[idx2] !== -9999 && data[idx3] !== -9999) {
            newIndices.push(idx1, idx2, idx3);
          }
        }
        // Update the geometry with filtered indices
        geometry.setIndex(newIndices);
      }
      // Set Z values for remaining vertices
      const arr1 = new Array(geometry.attributes.position.count);
      const arr = arr1.fill(1);
      arr.forEach((a, index) => {
        geometry.attributes.position.setZ(index, (data[index] / 25) * -1);
      });
      console.timeEnd('parseGeom');

      const texture = new TextureLoader().load(mountainImage);
      const material = new MeshLambertMaterial({
        wireframe: false,
        side: DoubleSide,
        map: texture,
        // Lighten up the material while still preventing bloom
        color: 0x999999, // Lighter gray - brighter than before but still below bloom threshold
      });

      const mountain = new Mesh(geometry, material);
      mountain.position.y = 0;
      mountain.rotation.x = Math.PI / 2;
      
      // Explicitly ensure the mountain mesh is not in the bloom layer
      mountain.layers.set(0); // Set to default layer (0), not bloom layer
      mountain.userData.isTerrain = true; // Mark as terrain for layer management
      
      this.scene.add(mountain);

      // Now that terrain bounds are set up, initialize the earthquake overlay
      this.setupEarthquakeOverlay();

      const loader = document.getElementById('loader');
      loader.style.opacity = '-1';

      // After a proper animation on opacity, hide element to make canvas clickable again
      setTimeout(() => {
        loader.style.display = 'none';
      }, 1500);
    };

    readGeoTif();
  }

  setupHelpers() {
    const gridHelper = new GridHelper(1000, 40, 0x333333, 0x333333); // Dark gray colors
    gridHelper.layers.set(0); // Set to default layer, not bloom
    this.scene.add(gridHelper);
    
    console.log('The X axis is red. The Y axis is green. The Z axis is blue.');
    const axesHelper = new AxesHelper(500);
    axesHelper.layers.set(0); // Set to default layer, not bloom
    this.scene.add(axesHelper);
  }
  
  setupEarthquakeOverlay() {
    // Add the earthquake overlay group to the scene
    this.scene.add(this.earthquakeOverlay.getObject3D());
    
    // Set the bloom scene layer for the earthquake overlay
    this.earthquakeOverlay.setBloomLayer(this.BLOOM_SCENE);
    
    // Add earthquake controls to the DOM
    const controls = createEarthquakeControls(this.earthquakeOverlay);
    document.body.appendChild(controls);
    
    // Add timeline controls
    const timeline = createEarthquakeTimeline(this.earthquakeOverlay, this.terrainBounds);
    document.body.appendChild(timeline);
    
    // Configure the bloom layer
    this.bloomLayer.set(this.BLOOM_SCENE);
    
    // Load earthquake data - use a longer time period for better visualization
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const startDate = oneMonthAgo.toISOString().split('T')[0];
    
    this.earthquakeOverlay.loadData(this.terrainBounds, startDate)
      .then(() => {
        // After data is loaded, visualize it with time filtering
        this.earthquakeOverlay.visualize(this.terrainBounds, this.earthquakeOverlay.currentTime);
        console.log('Earthquake data visualized');
        
        // Update layers for all earthquake objects after they're created
        this.earthquakeOverlay.getObject3D().children.forEach(child => {
          if (child.isMesh && child.userData && child.userData.isEarthquake) {
            // Store the original color for slider control
            if (child.material && !child.userData.originalColor) {
              child.userData.originalColor = child.material.color.clone();
            }
          }
        });
      })
      .catch(error => {
        console.error('Failed to load earthquake data:', error);
      });
      
    // Add mouse move handler for earthquake hovering
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      this.mouse.x = (event.clientX / this.width) * 2 - 1;
      this.mouse.y = -(event.clientY / this.height) * 2 + 1;
    });
    
    // Listen for bloom strength change events
    document.addEventListener('bloomStrengthChange', (event) => {
      // Update the bloom pass strength directly
      if (this.bloomPass) {
        this.bloomPass.strength = event.detail.strength;
        console.log("Bloom strength set to:", event.detail.strength);
        
        // Also adjust earthquake material brightness based on slider
        this.earthquakeOverlay.getObject3D().children.forEach(child => {
          if (child.userData && child.userData.isEarthquake && child.material) {
            // Store original color if not already stored
            if (!child.userData.originalColor) {
              child.userData.originalColor = child.material.color.clone();
            }
            
            // Adjust brightness based on slider value
            const brightnessFactor = 5.0 + event.detail.strength * 10.0; // MUCH higher brightness range
            const newColor = child.userData.originalColor.clone();
            newColor.multiplyScalar(brightnessFactor);
            
            child.material.color = newColor;
            child.material.needsUpdate = true;
          }
        });
      }
    });
    
    // Add click handler for earthquake selection
    this.renderer.domElement.addEventListener('click', () => {
      this.checkEarthquakeIntersection();
    });
  }
  
  checkEarthquakeIntersection() {
    // Only check if the overlay is visible
    if (!this.earthquakeOverlay.visible) return;
    
    // Update the picking ray with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObjects(this.earthquakeOverlay.getObject3D().children);
    
    const infoDiv = document.getElementById('earthquake-info');
    if (infoDiv) {
      if (intersects.length > 0) {
        const earthquake = intersects[0].object.userData.earthquake;
        if (earthquake) {
          infoDiv.style.display = 'block';
          infoDiv.innerHTML = `
            <strong>${earthquake.place || 'Unknown location'}</strong><br>
            Magnitude: ${earthquake.mag}<br>
            Depth: ${intersects[0].object.userData.depth.toFixed(2)} km<br>
            Time: ${new Date(earthquake.time).toLocaleString()}<br>
          `;
        }
      } else {
        infoDiv.style.display = 'none';
      }
    }
  }
}

(() => {
  const app = new Application({
    container: document.getElementById('canvas-container'),
  });
  console.log(app);
})();
