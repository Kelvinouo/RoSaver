let rsaver_placeid
let currentUrl = window.location.href
let isInitializing = false
let pendingPurchaseInfo = null // Track info from clicked store card

// Check if current URL is an item detail page (has numeric ID)
function isItemDetailPage(url = window.location.href) {
	// Match patterns like /catalog/12345/..., /bundles/12345/..., /game-pass/12345/...
	const match = url.match(/\/(catalog|bundles|game-pass)\/(\d+)/)
	return match !== null
}

function waitForElm(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
		if (document.querySelector(selector)) {
			return resolve(document.querySelector(selector));
		}

		const observer = new MutationObserver(mutations => {
			if (document.querySelector(selector)) {
				resolve(document.querySelector(selector));
				observer.disconnect();
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		// Timeout to prevent infinite waiting
		setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Element ${selector} not found within ${timeout}ms`));
		}, timeout);
	});
};

async function notification(title, message) {
	await chrome.runtime.sendMessage({
		type: "notification",
		title: title,
		message: message
	})
}

function makePurchase(productID, savedprice, type) {
	window.open(`roblox://placeId=${rsaver_placeid}&launchData=${productID},${savedprice},${type}`)
	window.location.reload()
};

// Clean up previous RoSaver elements
function cleanup() {
	$(".rsaver-savingRobux").remove()
	$(".rsaver").remove()
}

// Track clicks on store cards (game passes on game store pages)
function setupStoreCardTracking() {
	// Track clicks on buy buttons within store cards
	$(document).off('click.rosaver-track').on('click.rosaver-track', function(e) {
		const target = $(e.target)
		
		// Check if clicking a buy button or store card
		const isBuyButton = target.is('button') || target.closest('button').length > 0
		const isStoreCard = target.closest('.store-card, [class*="store-card"], .game-pass-container, [class*="game-pass"]').length > 0
		
		if (!isBuyButton && !isStoreCard) return
		
		// Find the store card container
		const card = target.closest('.store-card, [class*="store-card"], .game-pass-container, [class*="game-pass"]')
		if (card.length === 0) return
		
		// Try multiple ways to find the pass ID
		let passId = null
		let price = 0
		
		// Method 1: Check for game-pass link in the card
		const passLink = card.find('a[href*="game-pass"]').attr('href') || 
		                 card.attr('href') ||
		                 card.closest('a[href*="game-pass"]').attr('href')
		
		if (passLink) {
			const match = passLink.match(/game-pass\/(\d+)/)
			if (match) passId = match[1]
		}
		
		// Method 2: Check data attributes
		if (!passId) {
			const dataAttrs = ['data-item-id', 'data-pass-id', 'data-product-id', 'data-id', 'data-asset-id']
			for (const attr of dataAttrs) {
				passId = card.attr(attr) || card.find(`[${attr}]`).attr(attr)
				if (passId) break
			}
		}
		
		// Method 3: Look for any numeric ID in the card's container attributes
		if (!passId) {
			const allAttrs = card[0].attributes
			for (let i = 0; i < allAttrs.length; i++) {
				const match = allAttrs[i].value.match(/^(\d{8,})$/)
				if (match) {
					passId = match[1]
					break
				}
			}
		}
		
		// Get price from the card
		const priceText = card.find('.text-robux').first().text().replace(/,/g, '')
		price = parseInt(priceText) || 0
		
		if (passId) {
			pendingPurchaseInfo = {
				productID: passId,
				price: price,
				type: 2 // game pass
			}
			console.log('RoSaver - Tracked store card click:', pendingPurchaseInfo)
		} else if (price > 0) {
			// Store at least the price even if we couldn't get the ID
			pendingPurchaseInfo = {
				productID: null,
				price: price,
				type: 2
			}
			console.log('RoSaver - Tracked price but no pass ID:', price)
		}
	})
	
	// Also intercept XHR/fetch to capture pass ID from API calls
	const originalFetch = window.fetch
	window.fetch = async function(...args) {
		const response = await originalFetch.apply(this, args)
		try {
			const url = args[0].toString()
			// Check if this is a game pass purchase related request
			if (url.includes('game-pass') || url.includes('gamepass')) {
				const match = url.match(/\/(\d{8,})/)
				if (match && pendingPurchaseInfo) {
					pendingPurchaseInfo.productID = match[1]
					console.log('RoSaver - Got pass ID from fetch:', match[1])
				}
			}
		} catch (e) {}
		return response
	}
}

// Global Save button for modals (works on game store pages)
function addGlobalSaveButton() {
	if ($('.rsaver').length > 0) return // Already added
	if (rsaver_placeid == 0 || !rsaver_placeid) return // Not configured
	
	// Find the confirm/buy button in the modal
	let confirmButton = null
	const buttonSelectors = [
		".modal-button.btn-primary-md.btn-min-width",
		"#confirm-btn",
		".btn-primary-lg[type='button']",
		".modal-footer .btn-primary-md",
		".modal-buttons .btn-primary-md",
		".purchase-modal button.btn-primary-md",
		"[data-testid='confirm-btn']",
		".modal-content button.btn-primary-md"
	]
	
	for (const selector of buttonSelectors) {
		const btn = $(selector).not(".rsaver").first()
		if (btn.length > 0 && btn.text().toLowerCase().includes('buy')) {
			confirmButton = btn
			break
		}
	}
	
	// Fallback: find any primary button in modal
	if (!confirmButton || confirmButton.length === 0) {
		for (const selector of buttonSelectors) {
			const btn = $(selector).not(".rsaver").first()
			if (btn.length > 0) {
				confirmButton = btn
				break
			}
		}
	}
	
	if (!confirmButton || confirmButton.length === 0) return
	
	// Get price from modal
	const modalPriceElm = $(".modal-body .text-robux, .modal-message .text-robux").first()
	let price = 0
	let productID = null
	let type = 2 // default to game pass for game store pages
	
	if (modalPriceElm.length > 0) {
		price = parseInt(modalPriceElm.text().replace(/,/g, '')) || 0
	}
	
	// Try to get product ID from different sources
	// 1. From URL if on item detail page
	if (isItemDetailPage()) {
		productID = window.location.toString().split("/")[4]
		if (window.location.href.indexOf("game-pass") > -1) {
			type = 2
		} else if (window.location.href.indexOf("bundles") > -1) {
			type = 3
		} else {
			type = 1
		}
	}
	// 2. From tracked store card click
	else if (pendingPurchaseInfo) {
		productID = pendingPurchaseInfo.productID
		type = pendingPurchaseInfo.type
		if (!price && pendingPurchaseInfo.price) {
			price = pendingPurchaseInfo.price
		}
	}
	
	// Method 3: Try to get pass ID from React fiber data on modal elements
	if (!productID) {
		try {
			const modalElements = document.querySelectorAll('.modal-window, .modal-content, [class*="modal"]')
			for (const el of modalElements) {
				// Look for React fiber keys that might contain pass ID
				const keys = Object.keys(el)
				for (const key of keys) {
					if (key.startsWith('__reactFiber') || key.startsWith('__reactProps')) {
						const fiber = el[key]
						const fiberStr = JSON.stringify(fiber)
						// Look for pass ID pattern (8+ digit number)
						const match = fiberStr.match(/"(?:passId|productId|itemId|assetId|id)"\s*:\s*(\d{8,})/i)
						if (match) {
							productID = match[1]
							console.log('RoSaver - Got pass ID from React fiber:', productID)
							break
						}
					}
				}
				if (productID) break
			}
		} catch (e) {
			console.log('RoSaver - Error checking React fiber:', e)
		}
	}
	
	// Method 4: Check for pass ID in any data attribute in the modal
	if (!productID) {
		const modal = $('.modal-window, .modal-content').first()
		modal.find('[data-item-id], [data-pass-id], [data-product-id], [data-asset-id]').each(function() {
			const id = $(this).attr('data-item-id') || $(this).attr('data-pass-id') || 
			           $(this).attr('data-product-id') || $(this).attr('data-asset-id')
			if (id) {
				productID = id
				return false // break
			}
		})
	}
	
	// Method 5: Check Roblox's global state or window object
	if (!productID) {
		try {
			// Roblox sometimes stores current item info in window
			if (window.Roblox && window.Roblox.GamePassStore) {
				productID = window.Roblox.GamePassStore.currentPassId
			}
			// Check for React state in the page
			if (!productID && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
				// This is a fallback for debugging
			}
		} catch (e) {}
	}
	
	// Method 6: Look for pass ID in the store card that triggered the modal (by matching the name)
	if (!productID) {
		const passName = $('.modal-body .font-bold, .modal-message .font-bold').first().text().trim()
		if (passName) {
			// Find the store card with matching pass name
			$('.store-card, [class*="store-card"]').each(function() {
				const cardName = $(this).find('.store-card-name, [class*="card-name"]').text().trim()
				if (cardName === passName) {
					// Try to get ID from this card
					const cardLink = $(this).find('a[href*="game-pass"]').attr('href')
					if (cardLink) {
						const match = cardLink.match(/game-pass\/(\d+)/)
						if (match) {
							productID = match[1]
							console.log('RoSaver - Found pass ID by name match:', productID)
							return false // break
						}
					}
					// Check data attributes
					const id = $(this).attr('data-item-id') || $(this).find('[data-item-id]').attr('data-item-id')
					if (id) {
						productID = id
						return false // break
					}
				}
			})
		}
	}
	
	if (!productID || !price) {
		console.log('RoSaver - Could not determine product ID or price for modal. ID:', productID, 'Price:', price)
		return
	}
	
	// Calculate savings (10% for game passes, 40% for regular items)
	const savedRobux = Math.floor(price * (type === 2 ? 0.1 : type === 3 ? 0.1 : 0.4))
	
	if (savedRobux <= 0) return
	
	let clone = confirmButton.clone()
	clone.css({
		"background-color": "#00b06f",
		"border-color": "#00b06f",
		"color": "#fff"
	})
	clone.addClass("rsaver")
	clone.html(`Save <span class="icon-robux-16x16 wait-for-i18n-format-render"></span> ${savedRobux}`)
	clone.prependTo(confirmButton.parent())
	
	clone.on("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		// Close the modal
		$("div[role='dialog']").remove()
		$(".modal-backdrop").remove()
		$(".modal").remove()
		$(".modal-window").remove()
		
		makePurchase(productID, savedRobux, type)
		
		// Clear pending info
		pendingPurchaseInfo = null
	})
	
	console.log('RoSaver - Added Save button to modal, savings:', savedRobux)
}

// Set up global modal observer (works on all pages)
function setupGlobalModalObserver() {
	const modalObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				const hasModal = $('.modal-window, .modal-content, [class*="modal"]').length > 0
				const hasModalButton = $('.modal-button, .modal-footer button, .modal-buttons button').length > 0
				
				if (hasModal && hasModalButton) {
					setTimeout(() => {
						addGlobalSaveButton()
					}, 150)
				}
			}
		}
	})
	
	modalObserver.observe(document.body, {
		childList: true,
		subtree: true
	})
	
	// Also handle clicks as backup
	$(document).off('click.rosaver-modal').on('click.rosaver-modal', function() {
		setTimeout(() => {
			if ($('.modal-window, .modal-content').length > 0 && $('.rsaver').length === 0) {
				addGlobalSaveButton()
			}
		}, 250)
	})
}

// Add savings indicators to listing pages (game passes, catalog items)
function addSavingsToListings() {
	// Game pass store cards - 10% savings
	$(".store-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return // Already added
		
		const priceElm = $(this).find(".text-robux")
		if (priceElm.length === 0) return
		
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
		
		const savedRobux = Math.floor(price * 0.1) // 10% for game passes
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
	
	// Catalog item cards - 40% savings (or 10% for bundles)
	$(".item-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return // Already added
		
		const itemCard = $(this).closest(".item-card-container, .catalog-item-container, .item-card")
		
		// Skip LIMITED items - they can't be purchased through RoSaver
		const limitedIndicators = [
			".icon-limited-label",
			".icon-limited-unique-label",
			".icon-limited",
			".limited-icon",
			"[class*='limited']",
			".item-card-label"
		]
		let isLimited = false
		for (const selector of limitedIndicators) {
			const limitedEl = itemCard.find(selector)
			if (limitedEl.length > 0) {
				// Check if the element contains "limited" text or has limited class
				const text = limitedEl.text().toLowerCase()
				const className = limitedEl.attr('class') || ''
				if (text.includes('limited') || className.includes('limited')) {
					isLimited = true
					break
				}
			}
		}
		if (isLimited) return // Skip limited items
		
		const priceElm = $(this).find(".text-robux-tile")
		if (priceElm.length === 0) return
		
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
		
		// Check if it's a bundle (bundles get 10% savings, regular items get 40%)
		const itemLink = itemCard.find("a").attr("href") || ""
		const isBundle = itemLink.includes("/bundles/")
		
		const savedRobux = Math.floor(price * (isBundle ? 0.1 : 0.4))
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
}

// Watch for new items being added (infinite scroll, etc.)
function watchForNewListings() {
	const listingObserver = new MutationObserver((mutations) => {
		let hasNewItems = false
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				// Check if new store cards or item cards were added
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1) { // Element node
						if ($(node).find(".store-card-price, .item-card-price").length > 0 || 
							$(node).hasClass("store-card") || 
							$(node).hasClass("item-card-container") ||
							$(node).hasClass("catalog-item-container")) {
							hasNewItems = true
							break
						}
					}
				}
			}
			if (hasNewItems) break
		}
		
		if (hasNewItems) {
			// Small delay to let items fully render
			setTimeout(() => {
				addSavingsToListings()
			}, 100)
		}
	})
	
	listingObserver.observe(document.body, {
		childList: true,
		subtree: true
	})
}

async function initRoSaver() {
	// Prevent multiple simultaneous initializations
	if (isInitializing) return
	isInitializing = true

	try {
		// Clean up any existing RoSaver elements from previous page
		cleanup()

		let storageData = await chrome.storage.local.get()

		if (!storageData.totalSaved) storageData.totalSaved = 0
		if (!storageData.placeid) storageData.placeid = 0
		rsaver_placeid = storageData.placeid

		function saveData(object) {
			chrome.storage.local.set(object)
		}

		saveData(storageData)

		// Wait for the new item details container structure
		let requireRobuxElm = await waitForElm(".text-robux-lg")
		let requireRobux = $(requireRobuxElm).text().trim()
		
		// Updated selector for the new Roblox layout
		let infoDiv = await waitForElm("#item-details, .item-details-info-content, .shopping-cart.item-details-info-content")
		infoDiv = $(infoDiv)
		console.log("Init RoSaver - Price:", requireRobux)

		// Wait for the robux price container to be ready
		let robuxContainerElm = await waitForElm(".icon-robux-price-container, .price-info.row-content .icon-text-wrapper, .item-price-value")
		let robuxContainer = $(robuxContainerElm)
		console.log("RoSaver - Found price container:", robuxContainer.length > 0)
		
		if (requireRobux === "") {
			console.log("RoSaver - No price found, exiting")
			return
		}

		let productID = window.location.toString().split("/")[4]
		let price = requireRobux.replace(",", "")
		let savedRobux

		// Updated thumbnail selector for new layout
		let imgSrc = ""
		if ($(".thumbnail-2d-container img").length > 0) {
			imgSrc = $(".thumbnail-2d-container img")[0].src
		} else if ($("span.thumbnail-span > img").length > 0) {
			imgSrc = $("span.thumbnail-span > img")[0].src
		}

		let CSRF_Token = ""
		if ($('meta[name="csrf-token"]').length > 0) {
			CSRF_Token = $('meta[name="csrf-token"]').attr("data-token")
		}

		// Detect item type - updated selectors for new layout
		let type = ""
		
		// Check for limited items using multiple methods
		const limitedSelectors = [
			".icon-limited-label",
			".icon-limited-unique-label", 
			".icon-limited",
			".limited-icon",
			"[class*='limitedIcon']",
			"[class*='limited-icon']",
			"[data-testid*='limited']",
			".asset-restriction-icon .icon-limited-label",
			".item-restriction-icon"
		]
		
		let isLimited = false
		for (const selector of limitedSelectors) {
			if ($(selector).length > 0) {
				isLimited = true
				break
			}
		}
		
		// Also check for "Limited" text in specific areas
		if (!isLimited) {
			const pageText = $("#item-details").text() || $(".item-details-info-content").text() || ""
			if (pageText.includes("Limited") || pageText.includes("Collectible")) {
				isLimited = true
			}
		}
		
		// Check data attributes on the item container
		if (!isLimited) {
			const itemContainer = $("[data-is-limited='true'], [data-item-status*='limited']")
			if (itemContainer.length > 0) {
				isLimited = true
			}
		}
		
		// Check for resale/resellers section (only limited items have this)
		if (!isLimited) {
			const resaleSection = $(".resale-pricechart-tabs, .resellers-container, #asset-resale-data-container, [class*='resale'], [class*='reseller']")
			if (resaleSection.length > 0 && resaleSection.text().trim() !== "") {
				isLimited = true
			}
		}
		
		// Check for "Tradable: Yes" which indicates limited
		if (!isLimited) {
			const tradableText = $("#tradable-content").text().trim()
			if (tradableText === "Yes") {
				isLimited = true
			}
		}
		
		if (isLimited) {
			type = "limiteds"
		} else if (window.location.href.indexOf("game-pass") > -1) {
			type = 2
		} else if (window.location.href.indexOf("bundles") > -1) {
			type = 3
		} else {
			type = 1
		}

		if (!storageData.placeid || rsaver_placeid == 0) {
			robuxContainer.append(`
				<span class="rsaver-savingRobux rsaver-warning text-error font-caption-header">
					⚠️ RoSaver Setup Required
					<a href="https://www.youtube.com/video/icx6SWPOPQ4" 
					   target="_blank" 
					   class="btn-secondary-xs text-link"
					>📺 Watch Setup Tutorial</a>
				</span>
			`)
			return
		}
		
		if (type == 2 || type == 3) {
			// Game passes and bundles get 10% savings
			savedRobux = Math.floor(price * 0.1)
		} else {
			// Regular catalog items get 40% savings
			savedRobux = Math.floor(price * 0.4)
		}

		if (type !== "limiteds") {
			robuxContainer.append(`<span class="rsaver-savingRobux">(💰${savedRobux})</span>`)
		} else {
			return
		}

		// Function to add the Save button to the modal
		function addSaveButton() {
			if ($('.rsaver').length > 0) return // Already added our button
			
			// Try multiple selectors for the confirm button in the new layout
			let confirmButton = null
			
			const buttonSelectors = [
				".modal-button.btn-primary-md.btn-min-width",
				"#confirm-btn",
				".btn-primary-lg[type='button']",
				".modal-footer .btn-primary-md",
				".purchase-modal button.btn-primary-md",
				"[data-testid='confirm-btn']",
				".modal-content button.btn-primary-md"
			]
			
			for (const selector of buttonSelectors) {
				const btn = $(selector).not(".rsaver").first()
				if (btn.length > 0) {
					confirmButton = btn
					break
				}
			}

			if (!confirmButton || confirmButton.length === 0) return
			
			try {
				if (confirmButton.offsetParent()[0].toString() == "[object HTMLHtmlElement]") return
			} catch (e) {
				// Ignore offsetParent errors
			}

			let clone = confirmButton.clone()
			clone.css({
				"background-color": "#00b06f",
				"border-color": "#00b06f",
				"color": "#fff"
			})
			clone.addClass("rsaver")
			clone.html(`Save <span class="icon-robux-16x16 wait-for-i18n-format-render"></span> ${savedRobux}`)
			clone.prependTo(confirmButton.parent())
			
			clone.on("click", (e) => {
				e.preventDefault()
				e.stopPropagation()
				// Close the modal
				$("div[role='dialog']").remove()
				$(".modal-backdrop").remove()
				$(".modal").remove()
				$(".modal-window").remove()
				
				makePurchase(productID, savedRobux, type)
					.then((resp) => {
						console.log(resp)
					})
			})
		}

		// Watch for modal appearing using MutationObserver
		const modalObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					// Check if a modal was added
					const hasModal = $(".modal-window, .modal-content, [class*='modal']").length > 0
					const hasModalButton = $(".modal-button, .modal-footer button").length > 0
					
					if (hasModal && hasModalButton) {
						// Small delay to ensure modal is fully rendered
						setTimeout(() => {
							addSaveButton()
						}, 100)
					}
				}
			}
		})
		
		modalObserver.observe(document.body, {
			childList: true,
			subtree: true
		})

		// Also handle click as backup (with delay)
		$(document.body).off("click.rosaver")
		$(document.body).on("click.rosaver", () => {
			// Check for purchase modal with delay
			setTimeout(() => {
				if ($(".modal-window, .modal-content").length > 0) {
					addSaveButton()
				}
			}, 200)
		});

	} catch (error) {
		console.log("RoSaver - Error or timeout:", error.message)
	} finally {
		isInitializing = false
	}
}

// Watch for URL changes (SPA navigation)
function watchForUrlChanges() {
	// Check for URL changes periodically
	setInterval(() => {
		if (currentUrl !== window.location.href) {
			console.log("RoSaver - URL changed to:", window.location.href)
			currentUrl = window.location.href
			
			// Only run on item detail pages (has numeric ID)
			if (isItemDetailPage(currentUrl)) {
				console.log("RoSaver - Item detail page detected, reinitializing...")
				// Small delay to let the new page content load
				setTimeout(() => {
					initRoSaver()
				}, 800)
			} else {
				// Clean up if navigating away from item page
				cleanup()
				// Re-add savings to any listings on the new page
				setTimeout(() => {
					addSavingsToListings()
				}, 500)
			}
		}
	}, 300)
}

// Also watch for popstate events (back/forward navigation)
window.addEventListener("popstate", () => {
	console.log("RoSaver - Popstate event")
	currentUrl = window.location.href
	
	if (isItemDetailPage(currentUrl)) {
		console.log("RoSaver - Item detail page detected, reinitializing...")
		setTimeout(() => {
			initRoSaver()
		}, 800)
	} else {
		cleanup()
		setTimeout(() => {
			addSavingsToListings()
		}, 500)
	}
});

// Initial run
(async () => {
	const storageData = await chrome.storage.local.get()
	rsaver_placeid = storageData.placeid || 0
	
	if (isItemDetailPage()) {
		console.log("RoSaver - Starting on item detail page")
		initRoSaver()
	} else {
		console.log("RoSaver - Not on item detail page, adding savings to listings...")
	}
	
	// Always add savings to listings (game passes, catalog items)
	addSavingsToListings()
	watchForNewListings()
	watchForUrlChanges()
	
	// Set up global modal observer for game store pages and other pages
	setupStoreCardTracking()
	setupGlobalModalObserver()
	console.log("RoSaver - Global modal observer and store card tracking set up")
})()
