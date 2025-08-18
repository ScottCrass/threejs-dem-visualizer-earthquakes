import * as THREE from 'three';
import {
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  AmbientLight,
  WebGLRenderer,
  PlaneGeometry,
  GridHelper,
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
    
    // Mouse tracking for distinguishing clicks from drags
    this.mouseDownPosition = new Vector2();
    this.mouseUpPosition = new Vector2();
    this.isDragging = false;
    
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
      if (this.finalComposer) {
        this.finalComposer.setSize(w, h);
      }
      
      // Update bloom pass resolution for proper circular bloom
      if (this.bloomPass) {
        this.bloomPass.resolution.set(w, h);
      }
    });
    
    // Now that the camera is initialized, set up the bloom effect
    this.setupBloom();
  }

  render() {
    this.controls.update();
    this.updateCompassRotation();
    
    this.camera.layers.enableAll();
    this.finalComposer.render();
    
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
      alpha: false, // Disable alpha to prevent transparency issues
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000011, 1.0); // Dark blue-black with full alpha
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // Improved color rendering
    
    // Ensure consistent texture handling
    this.renderer.toneMapping = THREE.NoToneMapping;
    
    this.container.appendChild(this.renderer.domElement);
    
    // Setup bloom effect and composer after the camera is initialized
    // We'll do this at the end of the init method
    
    // Resize handling is now done in the init method
  }
  
  setupBloom() {
    // Simple single-pass bloom with proper depth testing
    const renderScene = new RenderPass(this.scene, this.camera);
    renderScene.clearColor = new THREE.Color(0x000011);
    renderScene.clearAlpha = 1.0;
    
    const bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      0.5,  // strength
      0.8,  // radius  
      0.8   // threshold - prevents terrain from blooming
    );
    
    this.bloomPass = bloomPass;
    
    this.finalComposer = new EffectComposer(this.renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(bloomPass);
    
    console.log('Simple bloom setup complete');
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
      
      // Set texture color space to SRGB for better color handling
      texture.colorSpace = THREE.SRGBColorSpace;
      
      
      const material = new MeshLambertMaterial({
        wireframe: false,
        side: DoubleSide,
        map: texture,
        color: 0xe8e8e8, // white
        transparent: false, // Start with no transparency
        opacity: 1.0, // Start at full opacity
        alphaTest: 0, // Disable alpha testing
      });

      const mountain = new Mesh(geometry, material);
      mountain.position.y = 0;
      mountain.rotation.x = Math.PI / 2;
      
      // Flip the terrain mesh horizontally to correct the mirror image
      mountain.scale.x = -1;
      
      // Store reference to terrain mesh for opacity control
      this.terrainMesh = mountain;
      
      this.scene.add(mountain);


      // Set terrain brightness to 4.2 directly
      if (this.terrainMesh && this.terrainMesh.material) {
        const originalColor = this.terrainMesh.material.color.clone();
        const newColor = originalColor.multiplyScalar(4.2);
        this.terrainMesh.material.color = newColor;
        this.terrainMesh.material.needsUpdate = true;
        console.log("Terrain brightness set to 4.2");
      }

      // Now that terrain bounds are set up, initialize the earthquake overlay
      this.setupEarthquakeOverlay();
      
      // Set up terrain opacity control after terrain is created
      this.setupTerrainOpacityControl();

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
    const gridHelper = new GridHelper(1000, 40, 0x222222, 0x222222);
    this.scene.add(gridHelper);
    
    this.initCompassRotation();
  }
  
  initCompassRotation() {
    // Initialize compass rotation based on camera direction
    this.compassElement = document.getElementById('compass');
    this.compassDir = new THREE.Vector3();
    this.compassSph = new THREE.Spherical();
    
    if (this.compassElement) {
      console.log('SVG compass initialized for rotation based on camera direction');
    } else {
      console.warn('Compass element not found - will retry after DOM is ready');
    }
  }
  
  updateCompassRotation() {
    // Update compass rotation in render loop
    if (this.compassElement && this.camera) {
      // Since the terrain mesh is rotated 90° around X-axis, we need to account for this
      // The mesh rotation essentially transforms the coordinate system:
      // - The mesh's "up" direction (originally Z) becomes Y
      // - The mesh's Y direction becomes -Z
      // - X remains X but the mesh is now flipped horizontally with scale.x = -1
      
      // Get camera position relative to scene center
      const cameraPos = this.camera.position.clone();
      
      // For the rotated and flipped terrain system:
      // Use -X and Y coordinates to account for both the 90° rotation and horizontal flip
      const angle = Math.atan2(-cameraPos.x, cameraPos.y);
      
      // Convert to degrees - no additional offset needed since we've corrected the coordinates
      const rotation = THREE.MathUtils.radToDeg(angle);
      this.compassElement.style.transform = `rotate(${rotation}deg)`;
    }
  }
  
  
  configureEarthquakesForClicking() {
    // Configure earthquake objects for interaction after they're created/recreated
    this.earthquakeOverlay.getObject3D().children.forEach((child) => {
      if (child.isMesh && child.userData && child.userData.isEarthquake) {
        // Scaling is now done during creation in earthquakeOverlay.js
        // No additional scaling needed here
        
        // Layer assignment is now done during creation in earthquakeOverlay.js
        // No need to reassign layers here - they should already be correct
        console.log('Earthquake configured - layers mask:', child.layers.mask, '(should be 3 for layers 0+1)');
      }
    });
  }
  
  setupEarthquakeOverlay() {
    // Add the earthquake overlay group to the scene
    this.scene.add(this.earthquakeOverlay.getObject3D());
    
    // Make sure the overlay is visible by default
    this.earthquakeOverlay.getObject3D().visible = true;
    
    // Add earthquake controls to the DOM
    const controls = createEarthquakeControls();
    document.body.appendChild(controls);
    
    // Add timeline controls
    const timeline = createEarthquakeTimeline(this.earthquakeOverlay, this.terrainBounds);
    document.body.appendChild(timeline);
    
    // Initialize compass rotation now that DOM elements are ready
    if (!this.compassElement) {
      this.initCompassRotation();
    }
    
    // Set up callback to reconfigure earthquakes whenever they're visualized
    this.earthquakeOverlay.onVisualize = () => {
      this.configureEarthquakesForClicking();
    };
    
    // Load earthquake data - use default one week period for initial load
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const startDate = oneWeekAgo.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0]; // Today
    
    this.earthquakeOverlay.loadData(this.terrainBounds, startDate, endDate)
      .then(() => {
        // After data is loaded, visualize it with time filtering
        this.earthquakeOverlay.visualize(this.terrainBounds, this.earthquakeOverlay.currentTime);
        console.log('Earthquake data visualized');
        
        // Configure earthquake objects for interaction
        this.configureEarthquakesForClicking();
      })
      .catch(error => {
        console.error('Failed to load earthquake data:', error);
      });
      
    // Add mouse handlers for distinguishing clicks from drags
    this.renderer.domElement.addEventListener('mousedown', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Record mouse down position
      this.mouseDownPosition.x = event.clientX;
      this.mouseDownPosition.y = event.clientY;
      this.isDragging = false;
    });
    
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      this.mouse.x = (event.clientX / this.width) * 2 - 1;
      this.mouse.y = -(event.clientY / this.height) * 2 + 1;
      
      // Check if we're dragging (mouse moved more than 5 pixels from mousedown position)
      if (this.mouseDownPosition) {
        const deltaX = Math.abs(event.clientX - this.mouseDownPosition.x);
        const deltaY = Math.abs(event.clientY - this.mouseDownPosition.y);
        if (deltaX > 5 || deltaY > 5) {
          this.isDragging = true;
        }
      }
    });
    
    this.renderer.domElement.addEventListener('mouseup', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Record mouse up position
      this.mouseUpPosition.x = event.clientX;
      this.mouseUpPosition.y = event.clientY;
      
      // Only trigger click logic if we weren't dragging
      if (!this.isDragging) {
        // Calculate mouse position for click event
        this.mouse.x = (event.clientX / this.width) * 2 - 1;
        this.mouse.y = -(event.clientY / this.height) * 2 + 1;
        
        // DEBUG: Log click event details
        console.log('Click event - clientX:', event.clientX, 'clientY:', event.clientY);
        console.log('Window dimensions:', this.width, 'x', this.height);
        console.log('Calculated mouse coords:', this.mouse.x, this.mouse.y);
        
        this.checkEarthquakeIntersection();
      } else {
        console.log('Drag detected, skipping earthquake intersection check');
      }
      
      // Reset drag state
      this.isDragging = false;
    });
    
    // Listen for bloom strength change events
    document.addEventListener('bloomStrengthChange', (event) => {
      // Update the bloom pass strength directly
      if (this.bloomPass) {
        this.bloomPass.strength = event.detail.strength;
        console.log("Bloom strength set to:", event.detail.strength);
        
        // Don't adjust individual earthquake colors here - let age-based colors handle that
        // The bloom pass strength adjustment is sufficient for controlling glow intensity
      }
    });
    
    // Add event listener for loading earthquake data with custom date range
    document.addEventListener('loadEarthquakeData', (event) => {
      const { startDate, endDate } = event.detail;
      console.log(`Loading earthquake data from ${startDate} to ${endDate}`);
      
      // Clear existing earthquake objects
      this.earthquakeOverlay.clearData();
      
      // Load new data with the specified date range
      this.earthquakeOverlay.loadData(this.terrainBounds, startDate, endDate)
        .then(() => {
          // After data is loaded, visualize it
          this.earthquakeOverlay.visualize(this.terrainBounds, this.earthquakeOverlay.currentTime);
          console.log(`Earthquake data loaded and visualized for period ${startDate} to ${endDate}`);
          
          // Configure earthquake objects for interaction
          this.configureEarthquakesForClicking();
        })
        .catch(error => {
          console.error('Failed to load earthquake data for date range:', error);
        });
    });
  }
  
  setupTerrainOpacityControl() {
    // Listen for terrain opacity change events
    document.addEventListener('terrainOpacityChange', (event) => {
      // Update terrain material opacity using direct reference
      if (this.terrainMesh && this.terrainMesh.material) {
        const opacity = event.detail.opacity;
        console.log("Setting terrain opacity to:", opacity);
        
        // Always enable transparency for opacity control
        this.terrainMesh.material.transparent = true;
        this.terrainMesh.material.opacity = opacity;
        
        // Set proper alpha test and blending
        this.terrainMesh.material.alphaTest = 0.01; // Small value to avoid z-fighting
        this.terrainMesh.material.depthWrite = opacity >= 0.99; // Only write depth when nearly opaque
        this.terrainMesh.material.needsUpdate = true;
        
        console.log("Terrain opacity updated to:", opacity);
      } else {
        console.log("Terrain mesh not found for opacity change");
      }
    });
  }
  
  checkEarthquakeIntersection() {
    console.log('Click detected - checking earthquake intersection');
    
    // Only check if the overlay group is visible
    if (!this.earthquakeOverlay.getObject3D().visible) {
      console.log('Earthquake overlay not visible, skipping intersection check');
      return;
    }
    
    // Two-click system: First click pauses timeline, second click selects earthquake
    if (this.earthquakeOverlay.isPlaying) {
      // First click - pause the timeline
      console.log('First click: pausing timeline');
      this.earthquakeOverlay.pause();
      return; // Don't check for earthquake intersection on first click
    }
    
    // Second click (timeline already paused) - check for earthquake selection
    console.log('Second click: checking for earthquake selection');
    
    // Update the picking ray with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Get all earthquake objects for intersection testing
    const earthquakeObjects = [];
    this.earthquakeOverlay.getObject3D().children.forEach((child) => {
      if (child.isMesh && child.userData?.isEarthquake) {
        earthquakeObjects.push(child);
      }
    });
    
    console.log(`Found ${earthquakeObjects.length} earthquake objects for intersection testing`);
    
    // Test for intersections with earthquake objects specifically
    const intersects = this.raycaster.intersectObjects(earthquakeObjects, false);
    const infoDiv = document.getElementById('earthquake-info');
    
    console.log(`Raycaster found ${intersects.length} intersections with earthquakes`);
    
    if (infoDiv) {
      if (intersects.length > 0) {
        const earthquakeObject = intersects[0];
        const earthquake = earthquakeObject.object.userData.earthquake;
        
        if (earthquake) {
          // Pause the timeline when an earthquake is clicked for better interaction
          console.log('Earthquake clicked, pausing timeline. Was playing:', this.earthquakeOverlay.isPlaying);
          this.earthquakeOverlay.pause();
          console.log('Timeline paused. Now playing:', this.earthquakeOverlay.isPlaying);
          
          // Build the popup content with earthquake details
          let popupContent = `
            <strong>${earthquake.place || 'Unknown location'}</strong><br>
            Magnitude: ${earthquake.mag}<br>
            Depth: ${earthquakeObject.object.userData.depth.toFixed(2)} km<br>
            Time: ${new Date(earthquake.time).toLocaleString()}<br>
          `;
          
          // Add USGS link if available
          if (earthquake.url) {
            popupContent += `<br><a href="${earthquake.url}" target="_blank" style="color: #0066cc; text-decoration: underline;">View at USGS.GOV</a>`;
          }
          
          infoDiv.style.display = 'block';
          infoDiv.innerHTML = popupContent;
          
          // Highlight the clicked earthquake temporarily
          const originalColor = earthquakeObject.object.material.color.clone();
          earthquakeObject.object.material.color.setRGB(1, 1, 1); // White highlight
          setTimeout(() => {
            earthquakeObject.object.material.color.copy(originalColor);
          }, 1000);
        }
      } else {
        console.log('No earthquake intersections found');
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
